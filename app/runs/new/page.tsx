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
  ["I1", "All five files are here"],
  ["I2", "SKU list matches the stock list"],
  ["I3", "Every sold SKU is known"],
  ["I4", "Quantities are whole numbers"],
  ["I5", "Perishability is High or Low"],
  ["I6", "One stock date, month in calendar"],
  ["I7", "Stock data is recent"],
  ["I8", "Every supplier is known"],
  ["I9", "No duplicate sales rows"],
  ["I10", "Sales end before the stock date"],
  ["I11", "All SKUs end the same week"],
  ["I12", "Overrides are valid"],
];

interface OverrideRow { sku: string; reason: string; until: string }
interface Latest { run_id: number; uploaded_at_local: string; uploaded_by: string; as_of_date: string; order_month: string; files: { name: string; rows: number; sha256: string }[] }
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
  const [source, setSource] = useState<"sap_latest" | "upload">("upload");
  const [latest, setLatest] = useState<Latest | null | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<Latest | null>("/sap/latest").then((l) => { setLatest(l); if (l) setSource("sap_latest"); }).catch(() => setLatest(null));
  }, []);

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

  const ready = source === "sap_latest" ? !!latest : REQUIRED.every((n) => files[n]);

  async function run() {
    setErr([]);
    setResult(null);
    setShown(0);
    setPhase("running");
    const fd = new FormData();
    fd.append("source", source);
    if (source === "upload") Object.values(files).forEach((f) => fd.append("files", f, f.name));
    const rows = ovr.filter((o) => o.sku.trim());
    if (source === "upload" && !files[OVERRIDES] && rows.length) {
      const csv = ["SKU_ID,Reason,Entered_By,Valid_Until",
        ...rows.map((o) => [o.sku.trim(), `"${o.reason.replace(/"/g, '""')}"`, "Analyst", o.until].join(","))].join("\n") + "\n";
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

  const stale = result?.validation.errors.some((e) => e.startsWith("I7"));
  const busy = phase === "running" || phase === "checking";
  const choices = [
    { v: "sap_latest" as const, title: "Latest SAP data", body: latest ? `Uploaded ${latest.uploaded_at_local.split(" ")[0]} · stock as of ${latest.as_of_date}` : latest === null ? "Nothing uploaded yet" : "Checking…" },
    { v: "upload" as const, title: "Upload new files", body: "Five CSV files exported from SAP" },
  ];

  return (
    <Container className="max-w-3xl py-16">
      <Reveal>
        <p className="eyebrow text-muted">New run</p>
        <h1 className="section-title mt-1">Run this week&apos;s plan.</h1>
        <p className="mt-3 text-lg text-muted">Pick the data, press Run. Raghav approves or rejects the result.</p>
      </Reveal>

      <div role="radiogroup" aria-label="Data source" className="mt-10 grid gap-3 sm:grid-cols-2">
        {choices.map((c) => (
          <motion.button key={c.v} role="radio" aria-checked={source === c.v} onClick={() => setSource(c.v)} disabled={busy}
            whileTap={{ scale: 0.98 }} className={`rounded-[22px] border-2 p-6 text-left transition-colors ${source === c.v ? "border-accent bg-tile" : "border-transparent bg-tile-alt hover:bg-[#ececf0]"}`}>
            <span className="flex items-center justify-between">
              <span className="text-xl font-semibold tracking-tight">{c.title}</span>
              <span aria-hidden className={`grid h-6 w-6 place-items-center rounded-full border-2 ${source === c.v ? "border-accent bg-accent" : "border-hairline"}`}>
                {source === c.v && <span className="h-2 w-2 rounded-full bg-white" />}
              </span>
            </span>
            <span className="mt-1 block text-sm text-muted">{c.body}</span>
          </motion.button>
        ))}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {source === "upload" ? (
          <motion.div key="upload" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
            className={`mt-4 rounded-[22px] border-2 border-dashed p-8 text-center transition-colors ${drag ? "border-accent bg-accent/5" : "border-hairline bg-tile"}`}>
            <p className="text-lg font-medium">Drop the SAP files here</p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => inputRef.current?.click()}>Choose files</Button>
            <input ref={inputRef} type="file" accept=".csv,text/csv" multiple className="sr-only" aria-label="Choose CSV files"
              data-testid="file-input" onChange={(e) => e.target.files && addFiles(e.target.files)} />
            <ul className="mx-auto mt-6 grid max-w-md gap-1.5 text-left text-sm">
              {REQUIRED.map((n) => (
                <li key={n} className="flex items-center justify-between rounded-xl bg-tile-alt px-3 py-2">
                  <span className="font-mono text-[13px]">{n}</span>
                  <span className={files[n] ? "text-green" : "text-muted"}>{files[n] ? "✓" : "needed"}</span>
                </li>
              ))}
            </ul>
            {ignored.length > 0 && <p className="mt-3 text-sm text-amber">Ignored: {ignored.join(", ")}</p>}
          </motion.div>
        ) : latest === null ? (
          <motion.p key="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 rounded-[22px] bg-tile-alt p-6 text-muted">
            No SAP data has been uploaded yet. Choose <button className="text-accent" onClick={() => setSource("upload")}>Upload new files</button> for the first run.
          </motion.p>
        ) : null}
      </AnimatePresence>

      <details className="group mt-6 rounded-[22px] bg-tile-alt px-6 py-4">
        <summary className="cursor-pointer list-none text-[15px] font-medium text-accent">
          <span className="group-open:hidden">More options</span><span className="hidden group-open:inline">Fewer options</span>
        </summary>
        <div className="mt-4 space-y-6">
          <div>
            <label htmlFor="run-date" className="font-semibold">Run date</label>
            <p className="mt-1 text-sm text-muted">Today by default. Stock data must be at most 7 days older than this date. Set an earlier date to replay old data.</p>
            <input id="run-date" type="date" value={runDate} onChange={(e) => setRunDate(e.target.value)}
              className="mt-2 w-full rounded-xl border border-hairline bg-tile px-3 py-2 sm:w-auto" />
          </div>
          {source === "upload" && (
            <div>
              <p className="font-semibold">Send a SKU to Raghav</p>
              <p className="mt-1 text-sm text-muted">For reasons the data can&apos;t show, like a competitor promotion. Or add judgment_overrides.csv to the upload.</p>
              <div className="mt-3 space-y-2">
                {ovr.map((o, i) => (
                  <div key={i} className="grid gap-2 sm:grid-cols-[110px_1fr_150px_auto]">
                    <input aria-label="SKU ID" placeholder="SKU001" value={o.sku} onChange={(e) => setOvr(ovr.map((x, k) => k === i ? { ...x, sku: e.target.value } : x))}
                      className="rounded-xl border border-hairline bg-tile px-3 py-2 text-sm" />
                    <input aria-label="Reason" placeholder="Reason" value={o.reason} onChange={(e) => setOvr(ovr.map((x, k) => k === i ? { ...x, reason: e.target.value } : x))}
                      className="rounded-xl border border-hairline bg-tile px-3 py-2 text-sm" />
                    <input aria-label="Valid until" type="date" value={o.until} onChange={(e) => setOvr(ovr.map((x, k) => k === i ? { ...x, until: e.target.value } : x))}
                      className="rounded-xl border border-hairline bg-tile px-3 py-2 text-sm" />
                    <Button variant="ghost" size="sm" onClick={() => setOvr(ovr.filter((_, k) => k !== i))}>Remove</Button>
                  </div>
                ))}
              </div>
              <Button variant="secondary" size="sm" className="mt-2" onClick={() => setOvr([...ovr, { sku: "", reason: "", until: runDate }])}>Add a SKU</Button>
            </div>
          )}
        </div>
      </details>

      <Button className="mt-8 w-full" size="lg" disabled={!ready || busy} onClick={run}>
        {phase === "running" ? "Running…" : phase === "checking" ? "Checking…" : "Run the plan"}
      </Button>
      <AnimatePresence>
        {busy && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-4 h-1.5 overflow-hidden rounded-full bg-tile-alt" role="progressbar" aria-label="Run progress">
            <motion.div className="h-full origin-left rounded-full bg-accent" initial={{ scaleX: 0 }}
              animate={{ scaleX: phase === "checking" ? 1 : 0.85 }} transition={{ duration: phase === "checking" ? 0.4 : 6, ease: "easeOut" }} />
          </motion.div>
        )}
      </AnimatePresence>
      <ErrorBox messages={err} />

      <AnimatePresence>
        {result && (
          <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mt-8 rounded-[22px] border border-hairline/70 bg-tile p-6" aria-live="polite">
            <h2 className="text-lg font-semibold">Checking the data</h2>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {CHECKS.map(([code, label], i) => {
                const done = i < shown;
                const pass = done ? result.validation.checks[code] : null;
                return (
                  <li key={code} className="flex items-center gap-3 text-sm">
                    <span className="relative grid h-6 w-6 shrink-0 place-items-center rounded-full bg-tile-alt">
                      <AnimatePresence>
                        {done && (
                          <motion.span initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 500, damping: 20 }}
                            className={`absolute inset-0 grid place-items-center rounded-full text-xs font-bold text-white ${pass ? "bg-green" : "bg-red"}`}
                            aria-label={pass ? "passed" : "failed"}>{pass ? "✓" : "✕"}</motion.span>
                        )}
                      </AnimatePresence>
                    </span>
                    <span className={done && !pass ? "text-red" : ""}>{label}</span>
                  </li>
                );
              })}
            </ul>
            {phase === "done" && result.status === "failed" && (
              <div className="mt-5 space-y-3">
                <p className="font-semibold text-red">The data didn&apos;t pass, so no plan was made.</p>
                {stale && <p className="text-sm">The SAP stock date is more than 7 days before the run date. Under <b>More options</b>, set the run date within a week of the stock date, or upload fresh files.</p>}
                <ErrorBox messages={result.validation.errors} />
              </div>
            )}
            {phase === "done" && result.status === "draft" && (
              <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-5 font-semibold text-green">All checks passed. Opening the plan…</motion.p>
            )}
          </motion.section>
        )}
      </AnimatePresence>
    </Container>
  );
}

export default function Page() {
  return <RequireRole roles={["analyst"]}><NewRun /></RequireRole>;
}
