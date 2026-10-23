"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";
import { Button } from "./ui";
import { useRole } from "./Providers";
import { api, download, errorMessages } from "@/lib/api";
import { n0 } from "@/lib/format";
import type { PO } from "@/lib/types";

const STATUS_TONE: Record<PO["status"], string> = {
  Generated: "bg-grey-soft text-grey",
  Downloaded: "bg-grey-soft text-grey",
  "Entered in ERPNext": "bg-accent/10 text-[#0058b0]",
  "ERPNext sync failed": "bg-red-soft text-red",
  "Submitted in ERPNext": "bg-green-soft text-green",
};
const STATUS_LABEL: Record<PO["status"], string> = {
  Generated: "Raised",
  Downloaded: "Raised",
  "Entered in ERPNext": "Draft in ERPNext",
  "ERPNext sync failed": "ERPNext sync failed",
  "Submitted in ERPNext": "Submitted",
};
const inr = (v: number) => `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One supplier's PO. Procurement finishes it here (rates, Required By, submit), never in ERPNext's own login. */
export function POTile({ po, onChange }: { po: PO; onChange: (p: PO) => void }) {
  const { role } = useRole();
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState<"complete" | "manual" | null>(null);
  const [rates, setRates] = useState<Record<string, string>>({});
  const [requiredBy, setRequiredBy] = useState(po.required_by ?? "");
  const [confirm, setConfirm] = useState(false);
  const [ref, setRef] = useState("");
  const [errs, setErrs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const notConnected = !po.erp_po_name && (po.erp_error ?? "").startsWith("ERPNext not connected");
  const submitted = po.status === "Submitted in ERPNext";
  const canComplete = role === "procurement" && !!po.erp_po_name && !submitted;

  const draftTotal = useMemo(() => {
    const vals = po.lines.map((l) => Number(rates[l.sku_id]));
    return vals.every((v) => v > 0) ? po.lines.reduce((a, l, i) => a + vals[i] * l.quantity, 0) : null;
  }, [rates, po.lines]);

  async function run(fn: () => Promise<void>) {
    setErrs([]);
    setBusy(true);
    try { await fn(); } catch (e) { setErrs(errorMessages(e)); }
    setBusy(false);
  }
  const retry = () => run(async () => onChange(await api<PO>(`/pos/${po.id}/erp-sync`, { method: "POST" })));
  async function dl(fmt: "pdf" | "xlsx" | "csv") {
    setMenu(false);
    await download(`/pos/${po.id}/download?format=${fmt}`);
    if (po.status === "Generated") onChange({ ...po, status: "Downloaded" });
  }
  function review() {
    const local: string[] = [];
    po.lines.forEach((l) => { if (!(Number(rates[l.sku_id]) > 0)) local.push(`Enter a rate above 0 for ${l.sku_id}.`); });
    if (!requiredBy) local.push("Choose the Required By date.");
    else if (requiredBy < po.po_date) local.push("Required By can't be before the PO date.");
    setErrs(local);
    if (!local.length) setConfirm(true);
  }
  const submit = () => run(async () => {
    const body = { rates: Object.fromEntries(po.lines.map((l) => [l.sku_id, Number(rates[l.sku_id])])), required_by: requiredBy };
    onChange(await api<PO>(`/pos/${po.id}/erp-submit`, { method: "POST", body: JSON.stringify(body) }));
    setPanel(null);
    setConfirm(false);
  });
  const markEntered = () => run(async () => {
    if (!ref.trim()) throw new Error("Enter the ERPNext PO reference.");
    onChange(await api<PO>(`/pos/${po.id}`, { method: "PATCH", body: JSON.stringify({ status: "Entered in ERPNext", erp_ref: ref.trim() }) }));
    setPanel(null);
  });

  return (
    <motion.article layout className="relative flex flex-col rounded-[24px] border border-hairline/70 bg-tile p-6" aria-labelledby={`po-${po.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[12px] text-muted">{po.supplier_region}</p>
          <h3 id={`po-${po.id}`} className="text-xl font-semibold tracking-tight">{po.supplier_name}</h3>
        </div>
        <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[po.status]}`}>{STATUS_LABEL[po.status]}</span>
      </div>
      <p className="mt-1 font-mono text-[12px] text-muted">{po.po_number}{po.erp_po_name ? ` · ERPNext ${po.erp_po_name}` : ""}</p>

      <ul className="mt-4 flex-1 space-y-2 text-sm">
        {po.lines.map((l) => (
          <li key={l.sku_id} className="flex items-center justify-between gap-3">
            <span className="min-w-0"><span className="font-mono text-[12px] text-muted">{l.sku_id}</span> {l.sku_name.replace(/^Freshroots /, "")}
              {l.rate != null && <span className="block text-[12px] text-muted">{n0(l.quantity)} × {inr(l.rate)}</span>}</span>
            {panel === "complete" ? (
              <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-muted">
                <span className="tabular">{n0(l.quantity)} ×</span>
                <span className="sr-only">Rate for {l.sku_id}</span>
                <span aria-hidden>₹</span>
                <input inputMode="decimal" value={rates[l.sku_id] ?? ""} placeholder="0.00"
                  onChange={(e) => { setRates({ ...rates, [l.sku_id]: e.target.value }); setConfirm(false); }}
                  className="tabular w-20 rounded-lg border border-hairline px-2 py-1 text-right text-sm text-ink" />
              </label>
            ) : (
              <span className="tabular shrink-0 font-medium">{n0(l.quantity)}</span>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-baseline justify-between border-t border-hairline/60 pt-3">
        <span className="text-sm text-muted">{po.total_amount != null ? `${n0(po.total_qty)} units` : "Total units"}</span>
        <span className="tabular text-2xl font-semibold">{po.total_amount != null ? inr(po.total_amount) : n0(po.total_qty)}</span>
      </div>

      {submitted ? (
        <p className="mt-2 text-sm text-green">Submitted to ERPNext{po.required_by ? ` · required by ${po.required_by}` : ""}{po.erp_submitted_by ? ` · by ${po.erp_submitted_by}` : ""}</p>
      ) : po.erp_po_name ? (
        <p className="mt-2 text-sm text-muted">Draft in ERPNext. {role === "procurement" ? "Add rates and a Required By date to submit it." : "Procurement adds rates and submits it."}</p>
      ) : po.erp_ref ? (
        <p className="mt-2 text-sm text-green">Entered by hand · ref {po.erp_ref}</p>
      ) : po.erp_error ? (
        <p role="status" className="mt-2 text-sm text-red">{po.erp_error}</p>
      ) : null}

      <div className="relative mt-4 flex flex-wrap gap-2">
        {canComplete && panel !== "complete" && <Button size="sm" onClick={() => { setPanel("complete"); setErrs([]); }}>Complete order</Button>}
        <Button size="sm" variant="secondary" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>Download ▾</Button>
        {(role === "procurement" || role === "analyst") && !po.erp_po_name && !notConnected && !po.erp_ref && (
          <Button size="sm" disabled={busy} onClick={retry}>{busy ? "Sending…" : "Retry ERPNext"}</Button>
        )}
        {role === "procurement" && !po.erp_po_name && !po.erp_ref && (
          <Button size="sm" variant="secondary" onClick={() => setPanel(panel === "manual" ? null : "manual")}>Entered manually</Button>
        )}
        <AnimatePresence>
          {menu && (
            <motion.ul role="menu" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              className="absolute left-0 top-10 z-20 w-40 overflow-hidden rounded-2xl border border-hairline bg-paper py-1 text-sm shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
              {(["pdf", "xlsx", "csv"] as const).map((f) => (
                <li key={f} role="none"><button role="menuitem" onClick={() => dl(f)} className="w-full px-4 py-2 text-left hover:bg-tile-alt">
                  {f === "pdf" ? "PDF" : f === "xlsx" ? "Excel" : "CSV"}</button></li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence initial={false}>
        {panel === "complete" && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mt-4 space-y-3 rounded-[18px] bg-tile-alt p-4">
              <p className="text-sm">Enter the rate for each SKU above, then the date you need the goods.</p>
              <label className="block text-[12px] text-muted">Required By
                <input type="date" min={po.po_date} value={requiredBy} onChange={(e) => { setRequiredBy(e.target.value); setConfirm(false); }}
                  className="mt-1 block w-full rounded-xl border border-hairline bg-tile px-3 py-2 text-sm text-ink" />
              </label>
              {draftTotal != null && <p className="flex justify-between text-sm"><span className="text-muted">Order value</span><span className="tabular font-semibold">{inr(draftTotal)}</span></p>}
              {!confirm ? (
                <div className="flex gap-2">
                  <Button size="sm" disabled={busy} onClick={review}>Review</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setPanel(null); setErrs([]); }}>Cancel</Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Submit this PO in ERPNext? It can&apos;t be edited after submitting.</p>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={busy} onClick={submit}>{busy ? "Submitting…" : "Submit to ERPNext"}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Back</Button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
        {panel === "manual" && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <label htmlFor={`ref-${po.id}`} className="mt-3 block text-[12px] text-muted">ERPNext PO reference</label>
            <div className="mt-1 flex gap-2">
              <input id={`ref-${po.id}`} value={ref} onChange={(e) => setRef(e.target.value)} className="min-w-0 flex-1 rounded-xl border border-hairline px-3 py-2 text-sm" />
              <Button size="sm" onClick={markEntered}>Save</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {errs.length > 0 && <ul role="alert" className="mt-2 space-y-0.5 text-sm text-red">{errs.map((e) => <li key={e}>{e}</li>)}</ul>}
    </motion.article>
  );
}
