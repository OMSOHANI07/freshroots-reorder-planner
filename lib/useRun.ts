"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessages } from "./api";
import type { Explanation, RunDetail } from "./types";

/** Loads a run and fills in AI explanations (generated once, then cached server-side). */
export function useRun(id: string) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [err, setErr] = useState<string[]>([]);
  const [explaining, setExplaining] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<RunDetail>(`/runs/${id}`);
      setRun(r);
      return r;
    } catch (e) {
      setErr(errorMessages(e));
      return null;
    }
  }, [id]);

  useEffect(() => {
    let alive = true;
    load().then(async (r) => {
      if (!r || r.status === "failed" || !alive) return;
      if (r.lines.every((l) => l.explanation) && r.procurement_note) return;
      setExplaining(true);
      try {
        const ex = await api<{ explanations: Record<string, Explanation>; procurement_note: string; procurement_note_source: "gemini" | "template" }>(
          `/runs/${id}/explain`, { method: "POST" });
        if (!alive) return;
        setRun((cur) => cur && {
          ...cur,
          procurement_note: ex.procurement_note,
          procurement_note_source: ex.procurement_note_source,
          lines: cur.lines.map((l) => ({ ...l, explanation: ex.explanations[l.sku_id] ?? l.explanation })),
        });
      } catch {
        /* explanations are optional; the plan still ships */
      } finally {
        if (alive) setExplaining(false);
      }
    });
    return () => { alive = false; };
  }, [id, load]);

  return { run, setRun, err, reload: load, explaining };
}
