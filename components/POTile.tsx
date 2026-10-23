"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { Button } from "./ui";
import { useRole } from "./Providers";
import { api, download, errorMessages } from "@/lib/api";
import { n0 } from "@/lib/format";
import type { PO } from "@/lib/types";

const STATUS_TONE = { Generated: "bg-grey-soft text-grey", Downloaded: "bg-grey-soft text-grey", "Entered in ERPNext": "bg-green-soft text-green", "ERPNext sync failed": "bg-red-soft text-red" };

export function POTile({ po, onChange }: { po: PO; onChange: (p: PO) => void }) {
  const { role } = useRole();
  const [menu, setMenu] = useState(false);
  const [entering, setEntering] = useState(false);
  const [ref, setRef] = useState("");
  const [errs, setErrs] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const notConnected = !po.erp_po_name && (po.erp_error ?? "").startsWith("ERPNext not connected");

  async function retry() {
    setErrs([]);
    setSyncing(true);
    try { onChange(await api<PO>(`/pos/${po.id}/erp-sync`, { method: "POST" })); } catch (e) { setErrs(errorMessages(e)); }
    setSyncing(false);
  }

  async function dl(fmt: "pdf" | "xlsx" | "csv") {
    setMenu(false);
    await download(`/pos/${po.id}/download?format=${fmt}`);
    if (po.status === "Generated") onChange({ ...po, status: "Downloaded" });
  }
  async function markEntered() {
    setErrs([]);
    if (!ref.trim()) return setErrs(["Enter the ERPNext PO reference."]);
    try {
      onChange(await api<PO>(`/pos/${po.id}`, { method: "PATCH", body: JSON.stringify({ status: "Entered in ERPNext", erp_ref: ref.trim() }) }));
      setEntering(false);
    } catch (e) {
      setErrs(errorMessages(e));
    }
  }

  return (
    <motion.article layout whileHover={{ scale: 1.02 }} transition={{ type: "spring", stiffness: 300, damping: 26 }}
      className="relative flex flex-col rounded-[24px] border border-hairline/70 bg-tile p-6" aria-labelledby={`po-${po.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[12px] text-muted">{po.supplier_region}</p>
          <h3 id={`po-${po.id}`} className="text-xl font-semibold tracking-tight">{po.supplier_name}</h3>
        </div>
        <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[po.status]}`}>{po.status}</span>
      </div>
      <p className="mt-1 font-mono text-[12px] text-muted">{po.po_number}</p>
      <ul className="mt-4 flex-1 space-y-1.5 text-sm">
        {po.lines.map((l) => (
          <li key={l.sku_id} className="flex justify-between gap-3">
            <span><span className="font-mono text-[12px] text-muted">{l.sku_id}</span> {l.sku_name.replace(/^Freshroots /, "")}
              {l.decision_source === "CHANGE" && <span className="ml-1 text-[11px] text-amber">changed from {n0(l.engine_qty)}</span>}</span>
            <span className="tabular font-medium">{n0(l.quantity)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-baseline justify-between border-t border-hairline/60 pt-3">
        <span className="text-sm text-muted">Total units</span><span className="tabular text-2xl font-semibold">{n0(po.total_qty)}</span>
      </div>
      {po.erp_po_name ? (
        <p className="mt-2 text-sm text-green">In ERPNext as {po.erp_po_name}{po.erp_status ? ` · ${po.erp_status}` : ""}
          {po.erp_url && <> · <a href={po.erp_url} target="_blank" rel="noreferrer" className="text-accent hover:underline">Open in ERPNext</a></>}</p>
      ) : po.erp_ref ? (
        <p className="mt-2 text-sm text-green">Entered by hand · ref {po.erp_ref}</p>
      ) : po.erp_error ? (
        <p role="status" className="mt-2 text-sm text-red">{po.erp_error}</p>
      ) : null}
      <div className="relative mt-4 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>Download ▾</Button>
        {(role === "procurement" || role === "analyst") && !po.erp_po_name && !notConnected && !po.erp_ref && (
          <Button size="sm" disabled={syncing} onClick={retry}>{syncing ? "Sending…" : "Retry ERPNext"}</Button>
        )}
        {role === "procurement" && !po.erp_po_name && !po.erp_ref && (
          <Button size="sm" variant="secondary" onClick={() => setEntering((x) => !x)}>Entered manually</Button>
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
      <AnimatePresence>
        {entering && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <label htmlFor={`zref-${po.id}`} className="mt-3 block text-[12px] text-muted">ERPNext PO reference</label>
            <div className="mt-1 flex gap-2">
              <input id={`zref-${po.id}`} value={ref} onChange={(e) => setRef(e.target.value)} className="min-w-0 flex-1 rounded-xl border border-hairline px-3 py-2 text-sm" />
              <Button size="sm" onClick={markEntered}>Save</Button>
            </div>
            {errs.length > 0 && <p role="alert" className="mt-1 text-sm text-red">{errs.join(" ")}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}
