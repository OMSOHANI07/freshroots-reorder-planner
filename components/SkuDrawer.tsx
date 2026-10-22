"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { FlagChip, Sparkline, StatusChip } from "./ui";
import { ACTION_LABEL, FLAG_LABEL, flagsOf, n0, n2, pct } from "@/lib/format";
import type { Line } from "@/lib/types";

function CoverBar({ label, value, min, max }: { label: string; value: number | null; min: number; max: number }) {
  const scale = Math.max(max * 1.6, (value ?? 0) * 1.1, 1);
  const pos = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  return (
    <div>
      <div className="flex justify-between text-sm"><span className="text-muted">{label}</span><span className="tabular font-semibold">{value == null ? "—" : `${n2(value)} wks`}</span></div>
      <div className="relative mt-2 h-2.5 rounded-full bg-tile-alt" role="img"
        aria-label={`${label}: ${value == null ? "not computed" : n2(value) + " weeks"}; healthy window ${min} to ${max} weeks`}>
        <div className="absolute inset-y-0 rounded-full bg-green-soft" style={{ left: pos(min), width: `calc(${pos(max)} - ${pos(min)})` }} />
        {value != null && <motion.div className="absolute inset-y-0 left-0 rounded-full bg-ink" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
          style={{ width: pos(value), transformOrigin: "left" }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted"><span>0</span><span>window {min}–{max} wks</span></div>
    </div>
  );
}

export function SkuDrawer({ line, onClose, children }: { line: Line | null; onClose: () => void; children?: React.ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!line) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [line, onClose]);

  return (
    <AnimatePresence>
      {line && (
        <>
          <motion.div className="fixed inset-0 z-[70] bg-black/25" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside role="dialog" aria-modal="true" aria-labelledby="drawer-title"
            className="fixed inset-y-0 right-0 z-[80] w-full max-w-lg overflow-y-auto bg-paper shadow-[0_0_0_1px_rgba(0,0,0,0.06)]"
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 320, damping: 34 }}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-hairline/60 bg-[rgba(251,251,253,0.85)] px-6 py-3 backdrop-blur-[20px]">
              <span className="font-mono text-sm text-muted">{line.sku_id}</span>
              <button ref={closeRef} onClick={onClose} className="rounded-full px-3 py-1 text-sm text-accent hover:bg-tile-alt">Close</button>
            </div>
            <div className="space-y-6 p-6">
              <div>
                <h2 id="drawer-title" className="text-2xl font-semibold tracking-tight">{line.sku_name}</h2>
                <p className="mt-1 text-sm text-muted">{line.category} · {line.perishability} perishability · {line.supplier_name} ({line.supplier_region})</p>
                <div className="mt-3 flex flex-wrap items-center gap-2"><StatusChip status={line.status} /><span className="text-sm">{ACTION_LABEL[line.action]}</span></div>
              </div>

              <section className="rounded-[20px] border border-hairline/70 bg-tile p-5">
                <h3 className="text-sm font-semibold">Sales, last {line.history.length} weeks</h3>
                <div className="mt-3"><Sparkline data={line.history.map((h) => h.units)}
                  label={`Weekly units sold for ${line.sku_id} from ${line.history[0]?.week} to ${line.history.at(-1)?.week}: ${line.history.map((h) => h.units).join(", ")}`} /></div>
                <div className="mt-1 flex justify-between text-[11px] text-muted"><span>{line.history[0]?.week}</span><span>{line.history.at(-1)?.week}</span></div>
                <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div><dt className="text-muted">Avg 4 wks</dt><dd className="tabular font-semibold">{n2(line.avg4)}</dd></div>
                  <div><dt className="text-muted">Avg 12 wks</dt><dd className="tabular font-semibold">{n2(line.avg12)}</dd></div>
                  <div><dt className="text-muted">Trend</dt><dd className="tabular font-semibold">{pct(line.trend)}</dd></div>
                  <div><dt className="text-muted">Expected / wk</dt><dd className="tabular font-semibold">{n2(line.forward_demand)}</dd></div>
                  <div><dt className="text-muted">On hand</dt><dd className="tabular font-semibold">{n0(line.units_on_hand)}</dd></div>
                  <div><dt className="text-muted">Std qty</dt><dd className="tabular font-semibold">{n0(line.std_qty)}</dd></div>
                </dl>
              </section>

              <section className="space-y-4 rounded-[20px] border border-hairline/70 bg-tile p-5">
                <CoverBar label="Cover before order" value={line.cover_weeks} min={line.min_weeks} max={line.max_weeks} />
                <CoverBar label="Cover after order" value={line.cover_after} min={line.min_weeks} max={line.max_weeks} />
                <dl className="grid grid-cols-3 gap-3 border-t border-hairline/60 pt-4 text-sm">
                  <div><dt className="text-muted">Order now</dt><dd className="tabular text-lg font-semibold">{n0(line.order_qty_now)}</dd></div>
                  <div><dt className="text-muted">Next cycle</dt><dd className="tabular text-lg font-semibold">{n0(line.next_cycle_qty)}</dd></div>
                  <div><dt className="text-muted">Shortfall</dt><dd className="tabular text-lg font-semibold">{n0(line.shortfall_units)}</dd></div>
                </dl>
              </section>

              <section className="rounded-[20px] border border-hairline/70 bg-tile p-5">
                <h3 className="text-sm font-semibold">Rules that fired</h3>
                <div className="mt-3 flex flex-wrap gap-1.5">{line.rules_fired.length ? line.rules_fired.map((r) => <FlagChip key={r} code={r} title={FLAG_LABEL[r]} />) : <span className="text-sm text-muted">None</span>}</div>
                {line.review_note && (
                  <ul className="mt-3 space-y-1 text-sm">
                    {flagsOf(line.review_flags).map((f, i) => <li key={f}><span className="font-semibold">{f}</span> · {line.review_note.split(" | ")[i]}</li>)}
                  </ul>
                )}
              </section>

              <section className="rounded-[20px] bg-tile-alt p-5" aria-live="polite">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">AI explanation</h3>
                  {line.explanation && <span className="rounded-full bg-tile px-2 py-0.5 text-[11px] text-muted">Source: {line.explanation.source === "gemini" ? "Gemini" : "Template (code)"}</span>}
                </div>
                {line.explanation ? (
                  <div className="mt-3 space-y-2 text-[15px]">
                    <p className="font-medium">{line.explanation.summary}</p>
                    <p className="text-muted">{line.explanation.why}</p>
                    {line.explanation.what_to_check && <p><span className="font-semibold">What to check:</span> {line.explanation.what_to_check}</p>}
                  </div>
                ) : <p className="mt-3 text-sm text-muted">Writing explanation…</p>}
                <p className="mt-3 text-[11px] text-muted">Explains the engine&apos;s numbers only. It never sets a quantity.</p>
              </section>
              {children}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
