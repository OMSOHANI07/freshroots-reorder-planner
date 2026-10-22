"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { Button, FlagChip, StatusChip } from "./ui";
import { ACTION_LABEL, FLAG_LABEL, flagsOf, n0, n2 } from "@/lib/format";
import type { DecisionKind, Line } from "@/lib/types";

export interface DecisionInput { sku_id: string; decision: DecisionKind; final_qty?: number; note?: string }

const LABEL: Record<DecisionKind, string> = { APPROVE: "Approve", CHANGE: "Change", REJECT: "Reject", HOLD: "Hold" };

export function DecisionCard({ line, onSave, onOpen, disabled }: {
  line: Line; onSave: (d: DecisionInput) => Promise<string[]>; onOpen: () => void; disabled?: boolean;
}) {
  const d = line.decision;
  const [mode, setMode] = useState<DecisionKind | null>(null);
  const [qty, setQty] = useState(String(d?.decision === "CHANGE" ? d.final_qty : line.order_qty_now));
  const [note, setNote] = useState(d?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<string[]>([]);

  async function submit(kind: DecisionKind) {
    setErrs([]);
    const local: string[] = [];
    const q = Number(qty);
    if (kind === "CHANGE" && (!/^\d+$/.test(qty.trim()) || q < 0)) local.push("Enter a whole number of units (0 or more).");
    if (kind !== "APPROVE" && !note.trim()) local.push("A note is required.");
    if (local.length) return setErrs(local);
    setBusy(true);
    const e = await onSave({ sku_id: line.sku_id, decision: kind, final_qty: kind === "CHANGE" ? q : undefined, note: note.trim() || undefined });
    setBusy(false);
    if (e.length) setErrs(e);
    else setMode(null);
  }

  const noteId = `note-${line.sku_id}`;
  const qtyId = `qty-${line.sku_id}`;
  return (
    <motion.article layout className={`rounded-[22px] border bg-tile p-5 sm:p-6 ${d ? "border-green/30" : "border-hairline/70"}`} aria-labelledby={`t-${line.sku_id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button onClick={onOpen} className="text-left">
            <span className="font-mono text-xs text-muted">{line.sku_id}</span>
            <h3 id={`t-${line.sku_id}`} className="text-lg font-semibold tracking-tight hover:underline">{line.sku_name}</h3>
          </button>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusChip status={line.status} />
            {flagsOf(line.review_flags).map((f) => <FlagChip key={f} code={f} title={FLAG_LABEL[f]} />)}
          </div>
        </div>
        <div className="text-right">
          <p className="text-[12px] text-muted">Engine recommends</p>
          <p className="tabular text-2xl font-semibold">{n0(line.order_qty_now)}<span className="text-sm font-normal text-muted"> units</span></p>
          <p className="text-[12px] text-muted">{ACTION_LABEL[line.action]} · cover {n2(line.cover_weeks)} / {line.min_weeks}–{line.max_weeks} wks</p>
        </div>
      </div>
      {line.review_note && <p className="mt-3 text-sm">{line.review_note}</p>}
      {line.explanation && <p className="mt-2 text-sm text-muted"><span className="font-medium text-ink">AI explanation ({line.explanation.source}):</span> {line.explanation.summary}</p>}

      <AnimatePresence initial={false}>
        {d && !mode && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-green-soft px-4 py-3 text-sm text-green">
            <span className="font-semibold">Raghav: {LABEL[d.decision]} · final {n0(d.final_qty)} units</span>
            {d.note && <span className="text-ink/80">“{d.note}”</span>}
          </motion.div>
        )}
      </AnimatePresence>

      {!disabled && (
        <div className="mt-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label={`Decision for ${line.sku_id}`}>
            <Button size="sm" variant={d?.decision === "APPROVE" ? "primary" : "secondary"} disabled={busy} onClick={() => { setMode(null); submit("APPROVE"); }}>Approve {n0(line.order_qty_now)}</Button>
            <Button size="sm" variant={mode === "CHANGE" ? "primary" : "secondary"} disabled={busy} onClick={() => setMode("CHANGE")}>Change</Button>
            <Button size="sm" variant={mode === "REJECT" ? "danger" : "secondary"} disabled={busy} onClick={() => setMode("REJECT")}>Reject</Button>
            <Button size="sm" variant={mode === "HOLD" ? "primary" : "secondary"} disabled={busy} onClick={() => setMode("HOLD")}>Hold</Button>
          </div>
          <AnimatePresence initial={false}>
            {mode && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="mt-4 grid gap-3 sm:grid-cols-[140px_1fr_auto] sm:items-end">
                  {mode === "CHANGE" ? (
                    <div>
                      <label htmlFor={qtyId} className="text-[12px] text-muted">Final quantity</label>
                      <input id={qtyId} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)}
                        className="tabular mt-1 w-full rounded-xl border border-hairline px-3 py-2" />
                    </div>
                  ) : <p className="text-sm text-muted sm:pb-2">Final quantity 0</p>}
                  <div>
                    <label htmlFor={noteId} className="text-[12px] text-muted">Note (required)</label>
                    <input id={noteId} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you did and why"
                      className="mt-1 w-full rounded-xl border border-hairline px-3 py-2" />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={busy} onClick={() => submit(mode)}>Save {LABEL[mode].toLowerCase()}</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setMode(null); setErrs([]); }}>Cancel</Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {errs.length > 0 && <ul role="alert" className="mt-2 text-sm text-red">{errs.map((e) => <li key={e}>{e}</li>)}</ul>}
        </div>
      )}
    </motion.article>
  );
}
