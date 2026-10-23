"use client";

import { motion } from "framer-motion";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PlanTable } from "@/components/PlanTable";
import { POTile } from "@/components/POTile";
import { RequireRole } from "@/components/RequireRole";
import { RunHeader } from "@/components/RunHeader";
import { SkuDrawer } from "@/components/SkuDrawer";
import { Button, Container, CountUp, ErrorBox, PillLink, Reveal, Spinner } from "@/components/ui";
import { api, download, errorMessages } from "@/lib/api";
import { useRun } from "@/lib/useRun";
import type { Line, PO } from "@/lib/types";

function Final() {
  const { id } = useParams<{ id: string }>();
  const { run, err } = useRun(id);
  const [pos, setPos] = useState<PO[] | null>(null);
  const [open, setOpen] = useState<Line | null>(null);
  const [errs, setErrs] = useState<string[]>([]);
  useEffect(() => { api<PO[]>(`/runs/${id}/pos`).then(setPos).catch((e) => setErrs(errorMessages(e))); }, [id]);

  if (err.length) return <Container className="py-16"><ErrorBox messages={err} /></Container>;
  if (!run) return <Container className="py-16"><Spinner /></Container>;
  if (run.status !== "final") {
    return (
      <Container className="py-16">
        <h1 className="section-title">Not final yet.</h1>
        <p className="mt-3 text-lg text-muted">Raghav hasn&apos;t approved this plan. POs appear here once it is approved.</p>
        <PillLink href={`/runs/${run.id}`} className="mt-6" variant="secondary">See the draft</PillLink>
      </Container>
    );
  }

  const finalTotal = run.lines.reduce((a, l) => a + (l.decision?.final_qty ?? 0), 0);
  const inErp = pos?.filter((p) => p.erp_po_name).length ?? 0;
  const refreshPos = () => api<PO[]>(`/runs/${id}/pos`).then(setPos).catch(() => {});
  async function dlAll(fmt: "pdf" | "xlsx" | "csv" | "zip") {
    try { await download(`/runs/${id}/pos/download?format=${fmt}`); refreshPos(); } catch (e) { setErrs(errorMessages(e)); }
  }

  return (
    <Container className="space-y-12 py-16">
      <RunHeader run={run} title="Approved. Orders are ready." />

      <div className="grid gap-3 sm:grid-cols-3">
        <Reveal><div className="rounded-[22px] bg-ink p-6 text-white"><p className="text-sm text-white/60">Units approved by Raghav</p><CountUp value={finalTotal} className="mt-1 block text-5xl font-semibold tracking-tight" /><p className="mt-2 text-sm text-white/60">{run.review_note ? `“${run.review_note}”` : "Approved as recommended."}</p></div></Reveal>
        <Reveal delay={0.05}><div className="h-full rounded-[22px] border border-hairline/70 bg-tile p-6"><p className="text-sm text-muted">POs in ERPNext</p><p className="mt-1 text-5xl font-semibold tracking-tight tabular">{pos ? `${inErp}/${pos.length}` : "—"}</p><p className="mt-2 text-sm text-muted">{pos && inErp < pos.length ? "Some POs need attention below." : "Created automatically on approval."}</p></div></Reveal>
        <Reveal delay={0.1}><div className="h-full rounded-[22px] border border-hairline/70 bg-tile p-6"><p className="text-sm text-muted">Approved by</p><p className="mt-1 text-2xl font-semibold tracking-tight">{run.finalised_by}</p><p className="mt-2 text-sm text-muted">{run.finalised_at_local}</p></div></Reveal>
      </div>

      <section aria-labelledby="po-title">
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="po-title" className="section-title">Purchase orders.</h2>
              <p className="mt-2 text-muted">One PO per supplier, created in ERPNext when Raghav approved. Procurement adds rates and submits each one here, with no ERPNext sign-in.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => dlAll("pdf")}>All PDF</Button>
              <Button size="sm" variant="secondary" onClick={() => dlAll("xlsx")}>All Excel</Button>
              <Button size="sm" variant="secondary" onClick={() => dlAll("csv")}>All CSV</Button>
              <Button size="sm" onClick={() => dlAll("zip")}>All as ZIP</Button>
            </div>
          </div>
          <ErrorBox messages={errs} />
          {!pos ? <div className="mt-6"><Spinner /></div> : pos.length === 0 ? <p className="mt-6 text-muted">No lines above 0 units: no POs.</p> : (
            <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {pos.map((p, i) => (
                <motion.div key={p.id} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.08, duration: 0.5 }}>
                  <POTile po={p} onChange={(np) => setPos((cur) => cur!.map((x) => (x.id === np.id ? np : x)))} />
                </motion.div>
              ))}
            </div>
          )}
          <p className="mt-4 text-sm text-muted">Until rates are entered, price columns in the files print as “—”.</p>
        </motion.div>
      </section>

      {run.procurement_note && (
        <Reveal>
          <section className="rounded-[24px] bg-tile-alt p-6 sm:p-8" aria-labelledby="note-title">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="note-title" className="text-xl font-semibold">Note to procurement</h2>
              <span className="rounded-full bg-tile px-2 py-0.5 text-[11px] text-muted">AI explanation · source: {run.procurement_note_source === "gemini" ? "Gemini" : "Template (code)"}</span>
            </div>
            <p className="mt-3 max-w-3xl text-[17px] leading-relaxed">{run.procurement_note}</p>
            <p className="mt-2 text-sm text-muted">The approved quantities below and on the POs are the ones that apply.</p>
          </section>
        </Reveal>
      )}

      <section aria-labelledby="locked-title">
        <h2 id="locked-title" className="mb-4 text-2xl font-semibold tracking-tight">Approved plan</h2>
        <PlanTable lines={run.lines} onOpen={setOpen} finalView />
      </section>
      <SkuDrawer line={open} onClose={() => setOpen(null)}>
        {open?.decision && (
          <section className="rounded-[20px] bg-ink p-5 text-white">
            <p className="text-sm text-white/60">Approved by Raghav</p>
            <p className="mt-1 text-2xl font-semibold">{open.decision.final_qty.toLocaleString("en-IN")} units</p>
            {open.decision.note && <p className="mt-2 text-white/80">“{open.decision.note}”</p>}
            <p className="mt-2 text-xs text-white/50">{open.decision.decided_by} · {open.decision.decided_at_local}</p>
          </section>
        )}
      </SkuDrawer>
    </Container>
  );
}

export default function Page() {
  return <RequireRole><Final /></RequireRole>;
}
