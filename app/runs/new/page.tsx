"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { RequireRole } from "@/components/RequireRole";
import { Button, Container, ErrorBox, Reveal } from "@/components/ui";
import { ApiError, api, errorMessages } from "@/lib/api";
import type { Summary, Validation } from "@/lib/types";

const REQUIRED = ["weekly_sales.csv", "sku_master.csv", "current_inventory.csv", "calendar.csv", "distributor_master.csv"];
const OVERRIDES = "judgment_overrides.csv";
const CHECKS: [string, string][] = [
  ["I1", "All five files with required columns"],
  ["I2", "SKUs match between master and inventory"],
  ["I3", "Every sales SKU is in the master"],
  ["I4", "Quantities are valid whole numbers"],
  ["I5", "Perishability is High or Low"],
  ["I6", "One As_Of_Date; order month in calendar"],
  ["I7", "Inventory snapshot is fresh"],
  ["I8", "Every distributor is known"],
  ["I9", "No duplicate sales rows"],
  ["I10", "Sales end on or before the inventory date"],
  ["I11", "All SKUs end in the same week"],
  ["I12", "Overrides file is valid (if present)"],
];

interface OverrideRow { sku: string; reason: string; until: string }
interface RunResp { run_id: number; status: string; validation: Validation; summary: Summary | null }

function todayIST() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function NewRun() {
  const router = useRouter();
  const [files, setFiles] = useState<Record<string, File>>({});
  const [ignored, setIgnored] = useState<string[]>([]);
  const [drag, setDrag] = useState(false);
  const [runDate, setRunDate] = useState(todayIST());
  const [ovr, setOvr] = useState<OverrideRow[]>([]);
  const [phase, setPhase] = useState<"idle" | "running" | "checking" | "done">("idle");
  const [result, setResult] = useState<RunResp | null>(null);
  const [shown, setShown] = useState(0);
  const [err, setErr] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((list: FileList | File[]) => {
    const next: Record<string, File> = {};
    const bad: string[] = [];
    for (const f of Array.from(list)) {
      if (REQUIRED.includes(f.name) || f.name === OVERRIDES) next[f.name] = f;
      else bad.push(f.name);
    }
    setFiles((p) => ({ ...p, ...next }));
    setIgnored(bad);
  }, []);

  const ready = REQUIRED.every((n) => files[n]);

  async function run() {
    setErr([]);
    setResult(null);
    setShown(0);
    setPhase("running");
    const fd = new FormData();
    Object.values(files).forEach((f) => fd.append("files", f, f.name));
    const rows = ovr.filter((o) => o.sku.trim());
    if (!files[OVERRIDES] && rows.length) {
      const csv = ["SKU_ID,Reason,Entered_By,Valid_Until",
        ...rows.map((o) => [o.sku.trim(), `"${o.reason.replace(/"/g, '""')}"`, "Raghav Kulkarni", o.until].join(","))].join("\n") + "\n";
      fd.append("files", new File([csv], OVERRIDES, { type: "text/csv" }));
    }
    fd.append("run_date", runDate);
    try {
      const r = await api<RunResp>("/runs", { method: "POST", body: fd });
      setResult(r);
    } catch (e) {
      if (e instanceof ApiError && e.status === 422 && (e.body as RunResp)?.validation) setResult(e.body as RunResp);
      else { setErr(errorMessages(e)); setPhase("idle"); return; }
    }
    setPhase("checking");
  }

  // tick the checklist one by one, then move on
  useEffect(() => {
    if (phase !== "checking" || !result) return;
    if (shown < CHECKS.length) {
      const t = setTimeout(() => setShown((s) => s + 1), 140);
      return () => clearTimeout(t);
    }
    setPhase("done");
  }, [phase, shown, result]);

  // once the checklist has finished, open the draft plan
  useEffect(() => {
    if (phase !== "done" || result?.status !== "draft") return;
    api(`/runs/${result.run_id}/explain`, { method: "POST" }).catch(() => {});
    const t = setTimeout(() => router.push(`/runs/${result.run_id}`), 900);
    return () => clearTimeout(t);
  }, [phase, result, router]);

  return (
    <Container className="py-16">
      <Reveal>
        <p className="eyebrow text-muted">New run</p>
        <h1 className="section-title mt-1">Drop this week&apos;s files.</h1>
        <p className="mt-3 max-w-2xl text-lg text-muted">Five CSVs from SAP, plus Raghav&apos;s optional overrides. Planned cadence: twice weekly.</p>
      </Reveal>

      <div className="mt-10 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
            className={`rounded-[24px] border-2 border-dashed p-8 text-center transition-colors ${drag ? "border-accent bg-accent/5" : "border-hairline bg-tile"}`}
          >
            <p className="text-lg font-medium">Drag and drop CSV files here</p>
            <p className="mt-1 text-sm text-muted">or</p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => inputRef.current?.click()}>Choose files</Button>
            <input ref={inputRef} type="file" accept=".csv,text/csv" multiple className="sr-only" aria-label="Choose CSV files"
              data-testid="file-input" onChange={(e) => e.target.files && addFiles(e.target.files)} />
            <ul className="mx-auto mt-6 grid max-w-md gap-2 text-left text-sm">
              {[...REQUIRED, OVERRIDES].map((n) => (
                <li key={n} className="flex items-center justify-between rounded-xl bg-tile-alt px-3 py-2">
                  <span className="font-mono text-[13px]">{n}{n === OVERRIDES && <span className="ml-2 font-sans text-muted">optional</span>}</span>
                  <span className={files[n] ? "text-green" : "text-muted"}>{files[n] ? "✓ Added" : n === OVERRIDES ? "—" : "Missing"}</span>
                </li>
              ))}
            </ul>
            {ignored.length > 0 && <p className="mt-3 text-sm text-amber">Ignored: {ignored.join(", ")}</p>}
          </div>

          <div className="rounded-[24px] border border-hairline/70 bg-tile p-6">
            <h2 className="text-lg font-semibold">Overrides (judgment zone, J2)</h2>
            <p className="mt-1 text-sm text-muted">Route SKUs to Raghav for reasons the data can&apos;t show. Used only when no overrides file is uploaded.</p>
            <div className="mt-4 space-y-2">
              {ovr.map((o, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[110px_1fr_150px_auto]">
                  <input aria-label="SKU ID" placeholder="SKU001" value={o.sku} onChange={(e) => setOvr(ovr.map((x, k) => k === i ? { ...x, sku: e.target.value } : x))}
                    className="rounded-xl border border-hairline px-3 py-2 text-sm" />
                  <input aria-label="Reason" placeholder="Competitor scheme" value={o.reason} onChange={(e) => setOvr(ovr.map((x, k) => k === i ? { ...x, reason: e.target.value } : x))}
                    className="rounded-xl border border-hairline px-3 py-2 text-sm" />
                  <input aria-label="Valid until" type="date" value={o.until} onChange={(e) => setOvr(ovr.map((x, k) => k === i ? { ...x, until: e.target.value } : x))}
                    className="rounded-xl border border-hairline px-3 py-2 text-sm" />
                  <Button variant="ghost" size="sm" onClick={() => setOvr(ovr.filter((_, k) => k !== i))}>Remove</Button>
                </div>
              ))}
            </div>
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => setOvr([...ovr, { sku: "", reason: "", until: runDate }])}>Add override</Button>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[24px] border border-hairline/70 bg-tile p-6">
            <label htmlFor="run-date" className="text-lg font-semibold">Run date</label>
            <p className="mt-1 text-sm text-muted">Defaults to today (IST). Raghav can set it to replay older data; the change is recorded in the audit log. I7 rejects inventory older than 7 days.</p>
            <input id="run-date" type="date" value={runDate} onChange={(e) => setRunDate(e.target.value)}
              className="mt-3 w-full rounded-xl border border-hairline px-3 py-2" />
            <Button className="mt-5 w-full" size="lg" disabled={!ready || phase === "running" || phase === "checking"} onClick={run}>
              {phase === "running" ? "Running…" : "Run the plan"}
            </Button>
            <AnimatePresence>
              {(phase === "running" || phase === "checking") && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-4 h-1.5 overflow-hidden rounded-full bg-tile-alt" role="progressbar" aria-label="Run progress">
                  <motion.div className="h-full origin-left rounded-full bg-accent"
                    initial={{ scaleX: 0 }} animate={{ scaleX: phase === "checking" ? 1 : 0.85 }}
                    transition={{ duration: phase === "checking" ? 0.4 : 6, ease: "easeOut" }} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="rounded-[24px] border border-hairline/70 bg-tile p-6">
            <h2 className="text-lg font-semibold">Validation checklist</h2>
            <ul className="mt-4 space-y-2" aria-live="polite">
              {CHECKS.map(([code, label], i) => {
                const done = result && i < shown;
                const pass = done ? result!.validation.checks[code] : null;
                return (
                  <li key={code} className="flex items-center gap-3 text-sm">
                    <span className="relative grid h-6 w-6 shrink-0 place-items-center rounded-full bg-tile-alt">
                      <AnimatePresence>
                        {done && (
                          <motion.span initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 500, damping: 20 }}
                            className={`absolute inset-0 grid place-items-center rounded-full text-xs font-bold text-white ${pass ? "bg-green" : "bg-red"}`}
                            aria-label={pass ? "passed" : "failed"}>
                            {pass ? "✓" : "✕"}
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </span>
                    <span className="font-mono text-[12px] text-muted">{code}</span>
                    <span className={done && !pass ? "text-red" : ""}>{label}</span>
                  </li>
                );
              })}
            </ul>
            {phase === "done" && result?.status === "failed" && (
              <div className="mt-5 space-y-2">
                <p className="font-semibold text-red">FATAL: no plan was written.</p>
                <ErrorBox messages={result.validation.errors} />
              </div>
            )}
            {phase === "done" && result?.status === "draft" && (
              <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-5 font-semibold text-green">
                All checks passed. Opening the draft plan…
              </motion.p>
            )}
            {result?.validation.warnings?.length ? <p className="mt-3 text-sm text-amber">{result.validation.warnings.join(" · ")}</p> : null}
          </div>
          <ErrorBox messages={err} />
        </div>
      </div>
    </Container>
  );
}

export default function Page() {
  return <RequireRole roles={["raghav"]}><NewRun /></RequireRole>;
}
