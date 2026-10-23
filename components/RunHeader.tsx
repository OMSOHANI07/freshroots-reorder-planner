"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { download } from "@/lib/api";
import type { RunDetail } from "@/lib/types";
import { Button, CountUp, Reveal } from "./ui";
import { n0 } from "@/lib/format";

const STATUS = {
  draft: { label: "Waiting for Raghav", tone: "bg-grey-soft text-grey" },
  final: { label: "Approved", tone: "bg-green-soft text-green" },
  rejected: { label: "Rejected", tone: "bg-amber-soft text-amber" },
  failed: { label: "Failed checks", tone: "bg-red-soft text-red" },
};

export function StatusPill({ status }: { status: RunDetail["status"] }) {
  const s = STATUS[status];
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${s.tone}`}><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />{s.label}</span>;
}

/** Title, one line of context, and everything technical tucked behind "Details". */
export function RunHeader({ run, title }: { run: RunDetail; title: string }) {
  const s = run.summary!;
  const [open, setOpen] = useState(false);
  const month = new Date(`${s.order_month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  return (
    <Reveal>
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill status={run.status} />
        <span className="text-sm text-muted">Plan #{run.id}</span>
      </div>
      <h1 className="section-title mt-3">{title}</h1>
      <p className="mt-3 text-lg text-muted">
        {month}{s.is_festival ? " · festival month" : ""} · stock as of {new Date(s.as_of_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
      </p>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-3 text-sm text-accent hover:underline">
        {open ? "Hide details" : "Details and downloads"}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mt-4 grid gap-4 rounded-[20px] bg-tile-alt p-5 text-sm sm:grid-cols-2">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                <dt className="text-muted">Data</dt><dd>{run.source === "sap_latest" ? `Latest SAP data (from plan #${run.source_run_id})` : "New SAP upload"}</dd>
                <dt className="text-muted">Run by</dt><dd>{run.created_by} · {run.created_at_local}</dd>
                <dt className="text-muted">Sales up to</dt><dd>{s.reference_week}</dd>
                <dt className="text-muted">Rule book</dt><dd>{run.rulebook_version} · config {run.config_sha256.slice(0, 8)}</dd>
                <dt className="text-muted">Checks</dt><dd>{s.for_sending ? "All 12 input and 8 output checks passed" : "Output checks failed: not for sending"}</dd>
                {run.finalised_by && <><dt className="text-muted">Decided</dt><dd>{run.finalised_by} · {run.finalised_at_local}</dd></>}
              </dl>
              <div className="flex flex-wrap content-start gap-2 sm:justify-end">
                <Button variant="secondary" size="sm" onClick={() => download(`/runs/${run.id}/plan?format=xlsx`)}>Plan (Excel)</Button>
                <Button variant="secondary" size="sm" onClick={() => download(`/runs/${run.id}/plan?format=csv`)}>Plan (CSV)</Button>
                <Button variant="secondary" size="sm" onClick={() => download(`/runs/${run.id}/plan?format=log`)}>Run log</Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Reveal>
  );
}

/** Three numbers that matter, then the status split as one bar. */
export function SummaryTiles({ run }: { run: RunDetail }) {
  const s = run.summary!;
  const big = [
    { label: "SKUs to reorder now", v: s.reorder_now },
    { label: "Units to order", v: s.total_units_now },
    { label: "Flagged for a closer look", v: s.needs_review },
  ];
  const parts = [
    { label: "Reorder now", v: s.reorder_now, c: "bg-red" },
    { label: "Pause", v: s.pause_next_order, c: "bg-amber" },
    { label: "Healthy", v: s.healthy, c: "bg-green" },
    { label: "Judgment zone", v: s.judgment_zone, c: "bg-grey" },
  ];
  const total = Math.max(1, s.skus_total);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {big.map((t, i) => (
          <Reveal key={t.label} delay={i * 0.06}>
            <div className="h-full rounded-[22px] border border-hairline/70 bg-tile p-6">
              <CountUp value={t.v} className="block text-5xl font-semibold tracking-tight" />
              <p className="mt-1 text-sm text-muted">{t.label}</p>
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal delay={0.15}>
        <div className="rounded-[22px] border border-hairline/70 bg-tile p-6">
          <p className="text-sm text-muted">All {s.skus_total} SKUs</p>
          <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-tile-alt" role="img"
            aria-label={parts.map((p) => `${p.label} ${p.v}`).join(", ")}>
            {parts.filter((p) => p.v > 0).map((p, i) => (
              <motion.div key={p.label} className={`h-full origin-left ${p.c}`} style={{ width: `${(p.v / total) * 100}%` }}
                initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }}
                transition={{ duration: 0.7, delay: 0.1 + i * 0.12, ease: [0.22, 1, 0.36, 1] }} />
            ))}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {parts.map((p) => (
              <li key={p.label} className="flex items-center gap-2"><span aria-hidden className={`h-2 w-2 rounded-full ${p.c}`} />{p.label} <span className="tabular font-semibold">{n0(p.v)}</span></li>
            ))}
          </ul>
        </div>
      </Reveal>
    </div>
  );
}
