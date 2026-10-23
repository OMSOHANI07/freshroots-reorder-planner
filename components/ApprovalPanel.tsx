"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ErrorBox } from "./ui";
import { api, errorMessages } from "@/lib/api";
import { FLAG_LABEL, flagsOf, n0 } from "@/lib/format";
import type { Line, PO, RunDetail } from "@/lib/types";

/** Raghav's only job: approve or reject the whole plan. Approval creates the POs in ERPNext. */
export function ApprovalPanel({ run, onOpen }: { run: RunDetail; onOpen: (l: Line) => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<string[]>([]);
  const [done, setDone] = useState<{ ok: number; failed: number } | null>(null);
  const flagged = run.lines.filter((l) => l.needs_raghav_review);
  const orderLines = run.lines.filter((l) => l.order_qty_now > 0);
  const suppliers = new Set(orderLines.map((l) => l.supplier_name));

  async function submit() {
    setErrs([]);
    if (mode === "reject" && !note.trim()) return setErrs(["Add a note saying why the plan is rejected."]);
    setBusy(true);
    try {
      if (mode === "approve") {
        const r = await api<{ pos: PO[] }>(`/runs/${run.id}/approve`, { method: "POST", body: JSON.stringify({ note: note.trim() || null }) });
        setDone({ ok: r.pos.filter((p) => p.erp_po_name).length, failed: r.pos.filter((p) => !p.erp_po_name).length });
        setTimeout(() => router.push(`/runs/${run.id}/final`), 1900);
      } else {
        await api(`/runs/${run.id}/reject`, { method: "POST", body: JSON.stringify({ note: note.trim() }) });
        router.refresh();
        window.location.reload();
      }
    } catch (e) {
      setErrs(errorMessages(e));
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="approval-title" className="rounded-[24px] bg-ink p-6 text-white sm:p-8">
      <p className="eyebrow text-white/60">Raghav&apos;s decision</p>
      <h2 id="approval-title" className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">Approve this plan?</h2>
      <p className="mt-3 max-w-2xl text-white/75">
        Approving orders {n0(run.summary!.total_units_now)} units across {orderLines.length} SKUs and raises {suppliers.size} purchase
        order{suppliers.size === 1 ? "" : "s"}, one per supplier (sent to ERPNext when it&apos;s connected). Rejecting orders nothing.
      </p>
      {flagged.length > 0 && (
        <div className="mt-6">
          <p className="text-sm font-semibold">Flagged by the rules · check before you decide</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {flagged.map((l) => (
              <li key={l.sku_id}>
                <button onClick={() => onOpen(l)} className="flex w-full items-start justify-between gap-3 rounded-2xl bg-white/5 px-4 py-3 text-left hover:bg-white/10">
                  <span>
                    <span className="font-mono text-xs text-white/50">{l.sku_id}</span>{" "}
                    <span className="font-medium">{l.sku_name.replace(/^Freshroots /, "")}</span>
                    <span className="mt-1 block text-[13px] text-white/60">{l.review_note}</span>
                  </span>
                  <span className="flex shrink-0 gap-1">{flagsOf(l.review_flags).map((f) => (
                    <span key={f} title={FLAG_LABEL[f]} className="rounded-md bg-white/15 px-1.5 py-0.5 text-[11px] font-semibold">{f}</span>
                  ))}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-6 flex flex-wrap gap-3">
        <Button size="lg" disabled={busy} onClick={() => setMode("approve")} className={mode === "reject" ? "opacity-60" : ""}>Approve plan</Button>
        <Button size="lg" variant="danger" disabled={busy} onClick={() => setMode("reject")} className={mode === "approve" ? "opacity-60" : ""}>Reject plan</Button>
      </div>
      <AnimatePresence initial={false}>
        {mode && !done && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <div>
                <label htmlFor="review-note" className="text-[13px] text-white/60">{mode === "reject" ? "Why are you rejecting it? (required)" : "Note (optional)"}</label>
                <input id="review-note" value={note} onChange={(e) => setNote(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-white placeholder:text-white/40"
                  placeholder={mode === "reject" ? "e.g. Festival uplift looks double-counted" : "Anything procurement should know"} />
              </div>
              <div className="flex gap-2">
                <Button disabled={busy} variant={mode === "reject" ? "danger" : "primary"} onClick={submit}>
                  {busy ? (mode === "approve" ? "Raising purchase orders…" : "Rejecting…") : mode === "approve" ? "Confirm approval" : "Confirm rejection"}
                </Button>
                <Button variant="ghost" className="text-white" onClick={() => { setMode(null); setErrs([]); }}>Cancel</Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="mt-3"><ErrorBox messages={errs} /></div>
      <AnimatePresence>
        {done && (
          <motion.div className="fixed inset-0 z-[95] grid place-items-center bg-paper/90 text-ink backdrop-blur" initial={{ opacity: 0 }} animate={{ opacity: 1 }} role="status">
            <div className="text-center">
              <motion.svg width="96" height="96" viewBox="0 0 96 96" className="mx-auto" aria-hidden initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18 }}>
                <circle cx="48" cy="48" r="44" fill="var(--green)" />
                <motion.path d="M28 50 L42 63 L68 35" fill="none" stroke="white" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"
                  initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.25, duration: 0.5 }} />
              </motion.svg>
              <p className="mt-6 text-3xl font-semibold tracking-tight">Plan approved.</p>
              <p className="mt-2 text-muted">
                {done.failed === 0 ? `${done.ok} PO${done.ok === 1 ? "" : "s"} created in ERPNext.` : done.ok === 0 ? "Purchase orders are ready for procurement." : `${done.ok} created in ERPNext · ${done.failed} need attention.`}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

