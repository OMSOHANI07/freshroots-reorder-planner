"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { RequireRole } from "@/components/RequireRole";
import { Container, ErrorBox, Reveal, Spinner } from "@/components/ui";
import { api, errorMessages } from "@/lib/api";
import { n0, pct, runHref } from "@/lib/format";
import type { AuditEntry, RunBrief } from "@/lib/types";

function TrendChart({ runs }: { runs: RunBrief[] }) {
  const pts = runs.filter((r) => r.status === "final" && r.override_rate != null).slice().reverse();
  const W = 640, H = 200, P = 28;
  if (!pts.length) return <p className="text-sm text-muted">The trend appears once a run is finalised.</p>;
  const x = (i: number) => P + (pts.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (pts.length - 1));
  const y = (v: number) => H - P - v * (H - 2 * P);
  const d = pts.map((r, i) => `${i ? "L" : "M"}${x(i)},${y(r.override_rate!)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
      aria-label={`Override rate by finalised run: ${pts.map((r) => `run ${r.id} ${pct(r.override_rate, 0)}`).join(", ")}. Kill line at 40%.`}>
      {[0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => (
        <g key={t}>
          <line x1={P} x2={W - P} y1={y(t)} y2={y(t)} stroke="var(--hairline)" strokeWidth="1" strokeDasharray={t === 0.4 ? "0" : "2 4"} />
          <text x={P - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--muted)">{t * 100}%</text>
        </g>
      ))}
      <line x1={P} x2={W - P} y1={y(0.4)} y2={y(0.4)} stroke="var(--red)" strokeWidth="1.5" />
      <text x={W - P} y={y(0.4) - 6} textAnchor="end" fontSize="11" fill="var(--red)">Kill line 40%</text>
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" />
      {pts.map((r, i) => (
        <g key={r.id}>
          <circle cx={x(i)} cy={y(r.override_rate!)} r="4.5" fill="var(--accent)" />
          <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted)">#{r.id}</text>
        </g>
      ))}
    </svg>
  );
}

function describe(a: AuditEntry) {
  const after = a.after ?? {};
  switch (a.action) {
    case "run.create": return `Created run (${String(after.status)}), run date ${String(after.run_date)}${after.run_date_overridden ? " (set by Raghav)" : ""}`;
    case "decision.save": return `${a.entity?.replace("sku:", "")}: ${a.before ? `${String((a.before as Record<string, unknown>).decision)} ${String((a.before as Record<string, unknown>).final_qty)} → ` : ""}${String(after.decision)} ${String(after.final_qty)} (engine ${String(after.engine_qty)})${after.note ? ` · “${String(after.note)}”` : ""}`;
    case "run.finalise": return `Finalised · override rate ${pct(after.override_rate as number, 0)} · POs ${(after.pos as string[]).join(", ") || "none"}`;
    case "po.download": return `${a.entity?.replace("po:", "")} downloaded (${String(after.format)})`;
    case "po.entered_in_zoho": return `${a.entity?.replace("po:", "")} entered in Zoho · ref ${String(after.zoho_ref)}`;
    default: return a.action;
  }
}

function History() {
  const [runs, setRuns] = useState<RunBrief[] | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [err, setErr] = useState<string[]>([]);
  const [runFilter, setRunFilter] = useState("");
  useEffect(() => { api<RunBrief[]>("/runs").then(setRuns).catch((e) => setErr(errorMessages(e))); }, []);
  useEffect(() => {
    api<AuditEntry[]>(`/audit${runFilter ? `?run_id=${runFilter}` : ""}`).then(setAudit).catch((e) => setErr(errorMessages(e)));
  }, [runFilter]);
  const finals = useMemo(() => runs?.filter((r) => r.status === "final") ?? [], [runs]);

  return (
    <Container className="space-y-12 py-16">
      <Reveal>
        <p className="eyebrow text-muted">History</p>
        <h1 className="section-title mt-1">Who changed what, and when.</h1>
      </Reveal>
      <ErrorBox messages={err} />
      <section className="rounded-[24px] border border-hairline/70 bg-tile p-6" aria-labelledby="trend-title">
        <h2 id="trend-title" className="text-xl font-semibold">Override rate trend</h2>
        <p className="mt-1 text-sm text-muted">Share of SKUs Raghav changed, rejected or held. Above 40% triggers the kill criterion.</p>
        <div className="mt-4">{runs ? <TrendChart runs={runs} /> : <Spinner />}</div>
        {finals.length > 0 && <p className="mt-2 text-sm text-muted">Latest: {pct(finals[0].override_rate, 0)} on run #{finals[0].id}</p>}
      </section>

      <section aria-labelledby="past-title">
        <h2 id="past-title" className="text-2xl font-semibold tracking-tight">Past runs</h2>
        <div className="mt-4 overflow-x-auto rounded-[20px] border border-hairline/70 bg-tile">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-hairline/70 text-[12px] text-muted"><tr>
              {["Run", "Created", "Order month", "Status", "Reorder", "Units", "Flagged", "Override rate"].map((h) => <th key={h} scope="col" className="px-4 py-3 font-medium">{h}</th>)}
            </tr></thead>
            <tbody>
              {runs?.map((r) => (
                <tr key={r.id} className="border-b border-hairline/40 last:border-0">
                  <td className="px-4 py-3"><Link href={runHref(r)} className="text-accent">#{r.id}</Link></td>
                  <td className="px-4 py-3 text-muted">{r.created_at_local}</td>
                  <td className="px-4 py-3">{r.order_month ?? "—"}</td>
                  <td className="px-4 py-3">{r.status}</td>
                  <td className="tabular px-4 py-3">{r.summary?.reorder_now ?? "—"}</td>
                  <td className="tabular px-4 py-3">{n0(r.summary?.total_units_now)}</td>
                  <td className="tabular px-4 py-3">{r.summary?.needs_review ?? "—"}</td>
                  <td className="tabular px-4 py-3">{pct(r.override_rate, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="audit-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="audit-title" className="text-2xl font-semibold tracking-tight">Audit log</h2>
          <select aria-label="Filter audit log by run" value={runFilter} onChange={(e) => setRunFilter(e.target.value)} className="rounded-full border border-hairline bg-tile px-3 py-1.5 text-sm">
            <option value="">All runs</option>
            {runs?.map((r) => <option key={r.id} value={r.id}>Run #{r.id}</option>)}
          </select>
        </div>
        {!audit ? <div className="mt-4"><Spinner /></div> : (
          <ol className="mt-4 divide-y divide-hairline/50 rounded-[20px] border border-hairline/70 bg-tile">
            {audit.map((a) => (
              <li key={a.id} className="grid gap-1 px-5 py-3 text-sm sm:grid-cols-[170px_150px_1fr]">
                <span className="tabular text-muted">{a.ts_local}</span>
                <span className="font-medium">{a.actor}</span>
                <span>{a.run_id != null && <span className="mr-2 text-muted">#{a.run_id}</span>}{describe(a)}</span>
              </li>
            ))}
            {audit.length === 0 && <li className="px-5 py-4 text-muted">No activity yet.</li>}
          </ol>
        )}
      </section>
    </Container>
  );
}

export default function Page() {
  return <RequireRole><History /></RequireRole>;
}
