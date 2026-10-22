"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { DecisionCard, type DecisionInput } from "@/components/DecisionCard";
import { RequireRole } from "@/components/RequireRole";
import { OverrideRate, RunHeader } from "@/components/RunHeader";
import { SkuDrawer } from "@/components/SkuDrawer";
import { Button, Container, ErrorBox, PillLink, Reveal, Spinner, StatusChip } from "@/components/ui";
import { api, errorMessages } from "@/lib/api";
import { ACTION_LABEL, n0 } from "@/lib/format";
import { useRun } from "@/lib/useRun";
import type { Line, RunBrief } from "@/lib/types";

function Review() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { run, err, reload } = useRun(id);
  const [open, setOpen] = useState<Line | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  const flagged = useMemo(() => run?.lines.filter((l) => l.needs_raghav_review || l.status === "JUDGMENT_ZONE") ?? [], [run]);
  const unflagged = useMemo(() => run?.lines.filter((l) => !(l.needs_raghav_review || l.status === "JUDGMENT_ZONE")) ?? [], [run]);
  const pendingUnflagged = unflagged.filter((l) => !l.decision);

  if (err.length) return <Container className="py-16"><ErrorBox messages={err} /></Container>;
  if (!run) return <Container className="py-16"><Spinner /></Container>;
  if (run.status !== "draft") {
    return (
      <Container className="py-16">
        <h1 className="section-title">This plan is {run.status === "final" ? "locked" : "not reviewable"}.</h1>
        {run.status === "final" && <PillLink href={`/runs/${run.id}/final`} className="mt-6">Open final dashboard</PillLink>}
      </Container>
    );
  }

  async function save(items: DecisionInput[], bulk = false): Promise<string[]> {
    try {
      await api<RunBrief>(`/runs/${id}/decisions`, { method: "POST", body: JSON.stringify({ decisions: items, approve_all_unflagged: bulk }) });
      await reload();
      return [];
    } catch (e) {
      return errorMessages(e);
    }
  }

  async function finalise() {
    setBusy(true);
    setErrs([]);
    try {
      await api(`/runs/${id}/finalise`, { method: "POST" });
      setDone(true);
      setTimeout(() => router.push(`/runs/${id}/final`), 1700);
    } catch (e) {
      setErrs(errorMessages(e));
      setBusy(false);
    }
  }

  const allDecided = run.lines.every((l) => l.decision);
  return (
    <Container className="space-y-10 py-16">
      <RunHeader run={run} eyebrow="Review · Raghav only" title="Your call, line by line." />
      <div className="sticky top-11 z-30 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b border-hairline/60 bg-[rgba(251,251,253,0.85)] px-4 py-3 backdrop-blur-[20px] sm:-mx-6 sm:px-6">
        <OverrideRate run={run} />
        <Button disabled={!allDecided || busy} onClick={finalise}>
          {allDecided ? "Finalise plan & generate POs" : `${run.sku_count - run.decided} SKUs still need a decision`}
        </Button>
      </div>
      <ErrorBox messages={errs} />

      <section aria-labelledby="flagged-title" className="space-y-4">
        <Reveal>
          <h2 id="flagged-title" className="text-2xl font-semibold tracking-tight">Flagged and judgment zone · {flagged.length}</h2>
          <p className="mt-1 text-muted">Each needs your explicit decision. Change and Reject need a note.</p>
        </Reveal>
        {flagged.map((l) => <DecisionCard key={l.sku_id} line={l} onSave={(d) => save([d])} onOpen={() => setOpen(l)} />)}
        {flagged.length === 0 && <p className="text-muted">Nothing flagged in this run.</p>}
      </section>

      <section aria-labelledby="unflagged-title" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="unflagged-title" className="text-2xl font-semibold tracking-tight">Unflagged · {unflagged.length}</h2>
            <p className="mt-1 text-muted">The rules handled these cleanly. Approve them together, or open one to change it.</p>
          </div>
          <Button variant="secondary" disabled={!pendingUnflagged.length} onClick={() => setConfirmBulk(true)}>
            Approve all {pendingUnflagged.length} unflagged
          </Button>
        </div>
        <ul className="divide-y divide-hairline/50 overflow-hidden rounded-[20px] border border-hairline/70 bg-tile">
          {unflagged.map((l) => (
            <li key={l.sku_id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <button onClick={() => setOpen(l)} className="text-left">
                <span className="mr-2 font-mono text-xs text-muted">{l.sku_id}</span><span className="font-medium hover:underline">{l.sku_name}</span>
              </button>
              <div className="flex items-center gap-3 text-sm">
                <StatusChip status={l.status} />
                <span className="text-muted">{ACTION_LABEL[l.action]}</span>
                <span className="tabular w-16 text-right">{n0(l.order_qty_now)}</span>
                <span className={`w-28 text-right ${l.decision ? "text-green" : "text-muted"}`}>{l.decision ? `${l.decision.decision} · ${n0(l.decision.final_qty)}` : "Pending"}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <SkuDrawer line={open} onClose={() => setOpen(null)}>
        {open && <DecisionCard line={run.lines.find((x) => x.sku_id === open.sku_id) ?? open} onSave={(d) => save([d])} onOpen={() => {}} />}
      </SkuDrawer>

      <AnimatePresence>
        {confirmBulk && (
          <motion.div className="fixed inset-0 z-[90] grid place-items-center bg-black/30 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div role="alertdialog" aria-modal="true" aria-labelledby="bulk-title" initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md rounded-[24px] bg-paper p-6">
              <h2 id="bulk-title" className="text-xl font-semibold">Approve {pendingUnflagged.length} unflagged SKUs?</h2>
              <p className="mt-2 text-sm text-muted">Each gets the engine&apos;s quantity as the final value ({n0(pendingUnflagged.reduce((a, l) => a + l.order_qty_now, 0))} units in total). You can still change any of them before finalising.</p>
              <div className="mt-6 flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setConfirmBulk(false)}>Cancel</Button>
                <Button autoFocus onClick={async () => { const e = await save([], true); setErrs(e); setConfirmBulk(false); }}>Approve all</Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {done && (
          <motion.div className="fixed inset-0 z-[95] grid place-items-center bg-paper/90 backdrop-blur" initial={{ opacity: 0 }} animate={{ opacity: 1 }} role="status">
            <div className="text-center">
              <motion.svg width="96" height="96" viewBox="0 0 96 96" className="mx-auto" aria-hidden initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18 }}>
                <circle cx="48" cy="48" r="44" fill="var(--green)" />
                <motion.path d="M28 50 L42 63 L68 35" fill="none" stroke="white" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"
                  initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.25, duration: 0.5 }} />
              </motion.svg>
              <p className="mt-6 text-3xl font-semibold tracking-tight">Plan approved.</p>
              <p className="mt-2 text-muted">POs are ready for procurement.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Container>
  );
}

export default function Page() {
  return <RequireRole roles={["raghav"]}><Review /></RequireRole>;
}
