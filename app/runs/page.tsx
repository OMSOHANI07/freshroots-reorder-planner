"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RequireRole } from "@/components/RequireRole";
import { Container, ErrorBox, PillLink, Reveal, Spinner } from "@/components/ui";
import { api, errorMessages } from "@/lib/api";
import { n0, pct, runHref } from "@/lib/format";
import type { RunBrief } from "@/lib/types";
import { useRole } from "@/components/Providers";

const BADGE = { draft: "bg-grey-soft text-grey", final: "bg-green-soft text-green", failed: "bg-red-soft text-red" };
const BADGE_LABEL = { draft: "Awaiting Raghav's approval", final: "Approved · locked", failed: "Failed validation" };

function Runs() {
  const { role } = useRole();
  const [runs, setRuns] = useState<RunBrief[] | null>(null);
  const [err, setErr] = useState<string[]>([]);
  useEffect(() => { api<RunBrief[]>("/runs").then(setRuns).catch((e) => setErr(errorMessages(e))); }, []);
  return (
    <Container className="py-16">
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow text-muted">Plans</p>
            <h1 className="section-title mt-1">Every run, on the record.</h1>
          </div>
          {role === "raghav" && <PillLink href="/runs/new">New run</PillLink>}
        </div>
      </Reveal>
      <div className="mt-10"><ErrorBox messages={err} /></div>
      {!runs && !err.length && <Spinner />}
      {runs && runs.length === 0 && <p className="text-muted">No runs yet.</p>}
      <ul className="grid gap-3">
        {runs?.map((r, i) => (
          <Reveal key={r.id} delay={Math.min(i * 0.04, 0.3)}>
            <li>
              <Link href={runHref(r)} className="flex flex-wrap items-center justify-between gap-4 rounded-[20px] border border-hairline/70 bg-tile px-5 py-4 transition-colors hover:bg-tile-alt">
                <div>
                  <p className="font-semibold">Run #{r.id} · {r.order_month ?? "—"}</p>
                  <p className="text-sm text-muted">{r.created_at_local} · {r.created_by} · run date {r.run_date}</p>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  {r.summary && <span className="tabular text-muted">{r.summary.reorder_now} reorder · {n0(r.summary.total_units_now)} units · {r.summary.needs_review} flagged</span>}
                  {r.status !== "failed" && <span className="tabular text-muted">{r.decided}/{r.sku_count} decided · override {pct(r.override_rate, 0)}</span>}
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE[r.status]}`}>{BADGE_LABEL[r.status]}</span>
                </div>
              </Link>
            </li>
          </Reveal>
        ))}
      </ul>
    </Container>
  );
}

export default function Page() {
  return <RequireRole><Runs /></RequireRole>;
}
