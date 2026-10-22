"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { PlanTable } from "@/components/PlanTable";
import { useRole } from "@/components/Providers";
import { RequireRole } from "@/components/RequireRole";
import { OverrideRate, PlanDownloads, RunHeader, SummaryTiles } from "@/components/RunHeader";
import { SkuDrawer } from "@/components/SkuDrawer";
import { Container, ErrorBox, PillLink, Reveal, Spinner } from "@/components/ui";
import { useRun } from "@/lib/useRun";
import type { Line } from "@/lib/types";

function Draft() {
  const { id } = useParams<{ id: string }>();
  const { role } = useRole();
  const { run, err, explaining } = useRun(id);
  const [open, setOpen] = useState<Line | null>(null);
  if (err.length) return <Container className="py-16"><ErrorBox messages={err} /></Container>;
  if (!run) return <Container className="py-16"><Spinner /></Container>;

  if (run.status === "failed") {
    return (
      <Container className="py-16">
        <p className="eyebrow text-red">Run #{run.id} · Failed validation</p>
        <h1 className="section-title mt-1">No plan was written.</h1>
        <p className="mt-3 text-muted">FATAL checks stop the run. Fix the files and run again.</p>
        <div className="mt-6"><ErrorBox messages={run.validation.errors} /></div>
        {role === "raghav" && <PillLink href="/runs/new" className="mt-6">New run</PillLink>}
      </Container>
    );
  }

  return (
    <Container className="space-y-10 py-16">
      <RunHeader run={run} eyebrow={run.status === "final" ? "Approved plan" : "Draft plan · Awaiting Raghav's approval"}
        title={run.status === "final" ? "Approved and locked." : "This week's plan."}>
        <PlanDownloads runId={run.id} />
      </RunHeader>
      {run.status === "draft" && (
        <Reveal>
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-[22px] bg-ink px-6 py-5 text-white">
            <div>
              <p className="font-semibold">Awaiting Raghav&apos;s approval</p>
              <p className="text-sm text-white/70">{run.summary!.needs_review} SKUs need an explicit decision. Procurement sees the final plan once Raghav finalises.</p>
            </div>
            <div className="flex items-center gap-3">
              <OverrideRate run={run} />
              {role === "raghav" && <PillLink href={`/runs/${run.id}/review`}>Review decisions</PillLink>}
            </div>
          </div>
        </Reveal>
      )}
      {run.status === "final" && <PillLink href={`/runs/${run.id}/final`}>Open final dashboard</PillLink>}
      <SummaryTiles run={run} />
      <section aria-labelledby="plan-title">
        <div className="mb-4 flex items-end justify-between">
          <h2 id="plan-title" className="text-2xl font-semibold tracking-tight">Recommendations</h2>
          {explaining && <Spinner label="Writing AI explanations…" />}
        </div>
        <PlanTable lines={run.lines} onOpen={setOpen} />
        <p className="mt-3 text-sm text-muted">Select a row for the 16-week sales sparkline, cover before and after, rules fired and the AI explanation. <Link className="text-accent" href="/history">History →</Link></p>
      </section>
      <SkuDrawer line={open} onClose={() => setOpen(null)} />
    </Container>
  );
}

export default function Page() {
  return <RequireRole><Draft /></RequireRole>;
}
