"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useRole } from "@/components/Providers";
import { RequireRole } from "@/components/RequireRole";
import { Container, ErrorBox, PillLink, Reveal, Sparkline, Spinner } from "@/components/ui";
import { api, errorMessages } from "@/lib/api";
import { n0 } from "@/lib/format";

interface Sku {
  sku_id: string; sku_name: string; category: string; perishability: "High" | "Low"; standard_reorder_qty: number;
  unit_of_measure: string; distributor_id: string; supplier_name: string; units_on_hand: number | null;
  location: string | null; sales: { week: string; units: number }[];
}
interface Master {
  run_id: number; uploaded_at_local: string; uploaded_by: string; as_of_date: string; skus: Sku[];
  suppliers: { distributor_id: string; distributor_name: string; region: string; status: string; sku_count: number }[];
  calendar: { year_month: string; is_festival_month: boolean }[];
  overrides: { sku_id: string; reason: string; entered_by: string; valid_until: string }[];
}

const TABS = ["SKUs", "Suppliers", "Festival calendar", "Overrides"] as const;
type Tab = (typeof TABS)[number];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function DataPage() {
  const { role } = useRole();
  const [m, setM] = useState<Master | null | undefined>(undefined);
  const [err, setErr] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>("SKUs");
  const [q, setQ] = useState("");
  useEffect(() => { api<Master | null>("/master").then(setM).catch((e) => setErr(errorMessages(e))); }, []);

  const skus = useMemo(() => (m?.skus ?? []).filter((k) =>
    !q || `${k.sku_id} ${k.sku_name} ${k.supplier_name} ${k.category}`.toLowerCase().includes(q.toLowerCase())), [m, q]);
  const years = useMemo(() => [...new Set((m?.calendar ?? []).map((c) => c.year_month.slice(0, 4)))], [m]);

  return (
    <Container className="py-16">
      <Reveal>
        <p className="eyebrow text-muted">Data</p>
        <h1 className="section-title mt-1">What the plan is built on.</h1>
        {m && <p className="mt-3 text-lg text-muted">Latest SAP data · uploaded {m.uploaded_at_local} by {m.uploaded_by} · stock as of {m.as_of_date}</p>}
      </Reveal>
      <ErrorBox messages={err} />
      {m === undefined && !err.length && <div className="mt-10"><Spinner /></div>}
      {m === null && (
        <div className="mt-10 rounded-[24px] bg-tile-alt p-8">
          <p className="text-lg">No SAP data yet.</p>
          {role === "analyst" && <PillLink href="/runs/new" className="mt-4">Upload SAP files</PillLink>}
        </div>
      )}
      {m && (
        <>
          <div role="tablist" aria-label="Master data" className="mt-10 inline-flex max-w-full overflow-x-auto rounded-full bg-tile-alt p-1">
            {TABS.map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                className={`relative whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors sm:px-5 ${tab === t ? "text-ink" : "text-muted hover:text-ink"}`}>
                {tab === t && <motion.span layoutId="data-tab" className="absolute inset-0 rounded-full bg-tile shadow-[0_1px_3px_rgba(0,0,0,0.08)]" transition={{ type: "spring", stiffness: 500, damping: 35 }} />}
                <span className="relative">{t}</span>
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div key={tab} role="tabpanel" aria-label={tab} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }} className="mt-8">
              {tab === "SKUs" && (
                <>
                  <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKU, name or supplier" aria-label="Search SKUs"
                    className="w-full max-w-md rounded-full border border-hairline bg-tile px-5 py-2.5" />
                  <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {skus.map((k) => (
                      <li key={k.sku_id} className="rounded-[22px] border border-hairline/70 bg-tile p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-mono text-xs text-muted">{k.sku_id}</p>
                            <p className="font-semibold leading-snug">{k.sku_name.replace(/^Freshroots /, "")}</p>
                          </div>
                          <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${k.perishability === "High" ? "bg-amber-soft text-amber" : "bg-tile-alt text-muted"}`}>
                            {k.perishability === "High" ? "Perishable" : "Long life"}
                          </span>
                        </div>
                        <div className="mt-3"><Sparkline data={k.sales.map((s) => s.units)} height={40}
                          label={`${k.sku_id} weekly sales ${k.sales[0]?.week} to ${k.sales.at(-1)?.week}: ${k.sales.map((s) => s.units).join(", ")}`} /></div>
                        <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                          <div><dt className="text-muted">On hand</dt><dd className="tabular font-semibold">{n0(k.units_on_hand)}</dd></div>
                          <div><dt className="text-muted">Std order</dt><dd className="tabular font-semibold">{n0(k.standard_reorder_qty)}</dd></div>
                          <div><dt className="text-muted">Last wk</dt><dd className="tabular font-semibold">{n0(k.sales.at(-1)?.units)}</dd></div>
                        </dl>
                        <p className="mt-3 text-[13px] text-muted">{k.category} · {k.supplier_name} · {k.unit_of_measure}</p>
                      </li>
                    ))}
                  </ul>
                  {skus.length === 0 && <p className="mt-6 text-muted">No SKUs match “{q}”.</p>}
                </>
              )}

              {tab === "Suppliers" && (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {m.suppliers.map((d) => (
                    <li key={d.distributor_id} className="rounded-[22px] border border-hairline/70 bg-tile p-6">
                      <p className="font-mono text-xs text-muted">{d.distributor_id}</p>
                      <p className="text-xl font-semibold tracking-tight">{d.distributor_name}</p>
                      <p className="mt-1 text-muted">{d.region} · {d.status}</p>
                      <p className="mt-4 text-sm"><span className="tabular text-2xl font-semibold">{d.sku_count}</span> <span className="text-muted">SKUs supplied</span></p>
                    </li>
                  ))}
                </ul>
              )}

              {tab === "Festival calendar" && (
                <div className="space-y-8">
                  <p className="text-muted">Festival months raise expected demand by 25%. They come only from this calendar.</p>
                  {years.map((y) => (
                    <div key={y}>
                      <h2 className="text-xl font-semibold">{y}</h2>
                      <ul className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-12">
                        {MONTHS.map((mn, i) => {
                          const c = m.calendar.find((x) => x.year_month === `${y}-${String(i + 1).padStart(2, "0")}`);
                          const fest = !!c?.is_festival_month;
                          return (
                            <li key={mn} className={`rounded-2xl px-3 py-4 text-center text-sm ${fest ? "bg-ink font-semibold text-white" : c ? "bg-tile-alt" : "bg-tile-alt text-muted/50"}`}
                              aria-label={`${mn} ${y}${fest ? ", festival month" : ""}`}>
                              {mn}{fest && <span className="mt-1 block text-[11px] font-normal text-white/70">Festival</span>}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}

              {tab === "Overrides" && (
                m.overrides.length ? (
                  <ul className="grid gap-3">
                    {m.overrides.map((o, i) => (
                      <li key={i} className="rounded-[22px] border border-hairline/70 bg-tile p-5">
                        <p><span className="font-mono text-sm text-muted">{o.sku_id}</span> · {o.reason}</p>
                        <p className="mt-1 text-sm text-muted">Entered by {o.entered_by} · valid until {o.valid_until}</p>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-muted">No overrides in the latest upload. Overrides send a SKU to Raghav for reasons the data can&apos;t show.</p>
              )}
            </motion.div>
          </AnimatePresence>
          <p className="mt-10 text-sm text-muted">This data is read-only here. It changes only with the next SAP upload; standard order quantities and perishability are owned by procurement with Raghav.</p>
        </>
      )}
    </Container>
  );
}

export default function Page() {
  return <RequireRole><DataPage /></RequireRole>;
}
