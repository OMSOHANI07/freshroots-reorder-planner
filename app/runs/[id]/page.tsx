"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { ApprovalPanel } from "@/components/ApprovalPanel";
import { PlanTable } from "@/components/PlanTable";
import { useRole } from "@/components/Providers";
import { RequireRole } from "@/components/RequireRole";
import { PlanDownloads, RunHeader, SourceTag, SummaryTiles } from "@/components/RunHeader";
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
        {role === "analyst" && <PillLink href="/runs/new" className="mt-6">New run</PillLink>}
      </Container>
    );
  }

  const title = { draft: "This week's plan.", final: "Approved.", rejected: "Rejected.", failed: "" }[run.status];
  const eyebrow = { draft: "Draft plan · Awaiting Raghav's approval", final: "Approved plan", rejected: `Rejected by ${run.finalised_by} · ${run.finalised_at_local}`, failed: "" }[run.status];
  return (
    <Container className="space-y-10 py-16">
      <RunHeader run={run} eyebrow={eyebrow} title={title}><PlanDownloads runId={run.id} /></RunHeader>
      <SourceTag run={run} />
      {run.status === "rejected" && (
        <Reveal>
          <div className="rounded-[22px] border border-amber/30 bg-amber-soft px-6 py-5">
            <p className="font-semibold text-amber">Raghav rejected this plan. No POs were created.</p>
            <p className="mt-1">“{run.review_note}”</p>
            {role === "analyst" && <PillLink href="/runs/new" className="mt-4">Start a new run</PillLink>}
          </div>
        </Reveal>
      )}
      {run.status === "final" && <PillLink href={`/runs/${run.id}/final`}>Open approved plan and POs</PillLink>}
      {run.status === "draft" && role === "raghav" && <Reveal><ApprovalPanel run={run} onOpen={setOpen} /></Reveal>}
      {run.status === "draft" && role !== "raghav" && (
        <Reveal>
          <div className="rounded-[22px] bg-ink px-6 py-5 text-white">
            <p className="font-semibold">Awaiting Raghav&apos;s approval</p>
            <p className="text-sm text-white/70">When Raghav approves, the purchase orders are created in Zoho Inventory automatically.</p>
          </div>
        </Reveal>
      )}
      <SummaryTiles run={run} />
      <section aria-labelledby="plan-title">
        <div className="mb-4 flex items-end justify-between">
          <h2 id="plan-title" className="text-2xl font-semibold tracking-tight">Recommendations</h2>
          {explaining && <Spinner label="Writing AI explanations…" />}
        </div>
        <PlanTable lines={run.lines} onOpen={setOpen} />
        <p className="mt-3 text-sm text-muted">Select a row for the 16-week sales sparkline, cover before and after, rules fired and the AI explanation.</p>
      </section>
      <SkuDrawer line={open} onClose={() => setOpen(null)} />
    </Container>
  );
}

export default function Page() {
  return <RequireRole><Draft /></RequireRole>;
}
