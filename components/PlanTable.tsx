"use client";

import { AnimatePresence, motion } from "framer-motion";
import { createColumnHelper, flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type SortingState } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { FlagChip, StatusChip } from "./ui";
import { ACTION_LABEL, FLAG_LABEL, STATUS_LABEL, flagsOf, n0, n2 } from "@/lib/format";
import type { Line, Status } from "@/lib/types";

const col = createColumnHelper<Line>();

export function PlanTable({ lines, onOpen, finalView = false }: { lines: Line[]; onOpen: (l: Line) => void; finalView?: boolean }) {
  const [status, setStatus] = useState<"" | Status>("");
  const [perish, setPerish] = useState("");
  const [supplier, setSupplier] = useState("");
  const [flagged, setFlagged] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);
  const suppliers = useMemo(() => [...new Set(lines.map((l) => l.supplier_name))].sort(), [lines]);

  const data = useMemo(() => lines.filter((l) =>
    (!status || l.status === status) && (!perish || l.perishability === perish) &&
    (!supplier || l.supplier_name === supplier) && (!flagged || l.needs_raghav_review)), [lines, status, perish, supplier, flagged]);

  const columns = useMemo(() => {
    const base = [
      col.accessor("sku_id", { header: "SKU", cell: (c) => <span className="font-mono text-[13px]">{c.getValue()}</span> }),
      col.accessor("sku_name", { header: "Name", cell: (c) => <span className="font-medium">{c.getValue().replace(/^Freshroots /, "")}</span> }),
      col.accessor("supplier_name", { header: "Supplier", cell: (c) => <span className="text-muted">{c.getValue()}</span> }),
      col.accessor("cover_weeks", { header: "Cover", cell: (c) => <span className="tabular">{n2(c.getValue())}<span className="text-muted"> / {c.row.original.min_weeks}–{c.row.original.max_weeks}</span></span> }),
      col.accessor("status", { header: "Status", cell: (c) => <StatusChip status={c.getValue()} /> }),
      col.accessor("action", { header: "Action", cell: (c) => <span className="text-[13px]">{ACTION_LABEL[c.getValue()]}</span> }),
      col.accessor("order_qty_now", { header: finalView ? "Approved qty" : "Order now", cell: (c) => <span className="tabular font-semibold">{n0(c.getValue())}</span> }),
    ];
    const tail = finalView
      ? [
          col.accessor("review_flags", { header: "Flags", enableSorting: false,
            cell: (c) => <span className="flex gap-1">{flagsOf(c.getValue()).map((f) => <FlagChip key={f} code={f} title={FLAG_LABEL[f]} />)}</span> }),
        ]
      : [
          col.accessor("next_cycle_qty", { header: "Next cycle", cell: (c) => <span className="tabular text-muted">{n0(c.getValue())}</span> }),
          col.accessor("review_flags", { header: "Flags", enableSorting: false,
            cell: (c) => <span className="flex gap-1">{flagsOf(c.getValue()).map((f) => <FlagChip key={f} code={f} title={FLAG_LABEL[f]} />)}</span> }),
        ];
    return [...base, ...tail];
  }, [finalView]);

  const table = useReactTable({ data, columns, state: { sorting }, onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getRowId: (r) => r.sku_id });

  const sel = "rounded-full border border-hairline bg-tile px-3 py-1.5 text-sm";
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        <select aria-label="Filter by status" className={sel} value={status} onChange={(e) => setStatus(e.target.value as Status | "")}>
          <option value="">All statuses</option>
          {(Object.keys(STATUS_LABEL) as Status[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select aria-label="Filter by perishability" className={sel} value={perish} onChange={(e) => setPerish(e.target.value)}>
          <option value="">All perishability</option><option value="High">High</option><option value="Low">Low</option>
        </select>
        <select aria-label="Filter by supplier" className={sel} value={supplier} onChange={(e) => setSupplier(e.target.value)}>
          <option value="">All suppliers</option>{suppliers.map((s) => <option key={s}>{s}</option>)}
        </select>
        <label className="flex cursor-pointer items-center gap-2 rounded-full border border-hairline bg-tile px-3 py-1.5 text-sm">
          <input type="checkbox" checked={flagged} onChange={(e) => setFlagged(e.target.checked)} className="accent-[var(--accent)]" />
          Flagged only
        </label>
        <span className="ml-auto text-sm text-muted" aria-live="polite">{data.length} of {lines.length} SKUs</span>
      </div>
      <div className="mt-4 overflow-x-auto rounded-[20px] border border-hairline/70 bg-tile">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="border-b border-hairline/70 text-[12px] text-muted">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} scope="col" className="px-4 py-3 font-medium"
                    aria-sort={h.column.getIsSorted() === "asc" ? "ascending" : h.column.getIsSorted() === "desc" ? "descending" : undefined}>
                    {h.column.getCanSort() ? (
                      <button onClick={h.column.getToggleSortingHandler()} className="hover:text-ink">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {{ asc: " ↑", desc: " ↓" }[h.column.getIsSorted() as string] ?? ""}
                      </button>
                    ) : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {table.getRowModel().rows.map((row, i) => (
                <motion.tr key={row.id} layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.25, delay: Math.min(i * 0.02, 0.2) }}
                  tabIndex={0} onClick={() => onOpen(row.original)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(row.original))}
                  aria-label={`${row.original.sku_id} details`}
                  className="cursor-pointer border-b border-hairline/40 last:border-0 hover:bg-tile-alt focus-visible:bg-tile-alt">
                  {row.getVisibleCells().map((c) => <td key={c.id} className="px-4 py-3 align-middle">{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
    </div>
  );
}
