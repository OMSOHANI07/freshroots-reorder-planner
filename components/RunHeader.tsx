"use client";

import { download } from "@/lib/api";
import type { RunDetail } from "@/lib/types";
import { Button, CountUp, Reveal } from "./ui";
import { n0 } from "@/lib/format";

export function RunHeader({ run, eyebrow, title, children }: { run: RunDetail; eyebrow: string; title: string; children?: React.ReactNode }) {
  const s = run.summary!;
  return (
    <Reveal>
      <p className="eyebrow text-muted">{eyebrow}</p>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
        <h1 className="section-title">{title}</h1>
        <div className="flex flex-wrap gap-2">{children}</div>
      </div>
      <p className="mt-3 text-sm text-muted">
        Run #{run.id} · Order month {s.order_month}{s.is_festival ? " (festival month, +uplift)" : ""} · Inventory as of {s.as_of_date} · Reference week {s.reference_week} ·
        Rule book {run.rulebook_version} · config {run.config_sha256.slice(0, 8)} · Pre-send checks {s.for_sending ? "passed" : "FAILED: not for sending"}
      </p>
    </Reveal>
  );
}

export function SummaryTiles({ run }: { run: RunDetail }) {
  const s = run.summary!;
  const tiles = [
    { label: "Reorder now", v: s.reorder_now, tone: "text-red" },
    { label: "Pause next order", v: s.pause_next_order, tone: "text-amber" },
    { label: "Healthy", v: s.healthy, tone: "text-green" },
    { label: "Judgment zone", v: s.judgment_zone, tone: "text-grey" },
    { label: "Units to order now", v: s.total_units_now, tone: "" },
    { label: "Flagged for Raghav", v: s.needs_review, tone: "" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((t, i) => (
        <Reveal key={t.label} delay={i * 0.05}>
          <div className="h-full rounded-[20px] border border-hairline/70 bg-tile p-5">
            <CountUp value={t.v} className={`block text-4xl font-semibold tracking-tight ${t.tone}`} />
            <p className="mt-1 text-[13px] text-muted">{t.label}</p>
          </div>
        </Reveal>
      ))}
    </div>
  );
}

export function PlanDownloads({ runId }: { runId: number }) {
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => download(`/runs/${runId}/plan?format=csv`)}>Plan CSV</Button>
      <Button variant="secondary" size="sm" onClick={() => download(`/runs/${runId}/plan?format=xlsx`)}>Plan Excel</Button>
      <Button variant="secondary" size="sm" onClick={() => download(`/runs/${runId}/plan?format=log`)}>Run log</Button>
    </>
  );
}

export function SourceTag({ run }: { run: RunDetail }) {
  return (
    <span className="rounded-full bg-tile-alt px-3 py-1 text-sm">
      {run.source === "sap_latest" ? `Latest SAP data (from run #${run.source_run_id})` : "New SAP upload"} · {n0(run.sku_count)} SKUs
    </span>
  );
}
