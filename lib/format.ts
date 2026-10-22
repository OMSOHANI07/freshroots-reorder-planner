import type { Status } from "./types";

export const n0 = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("en-IN"));
export const n2 = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pct = (v: number | null | undefined, dp = 1) => (v == null ? "—" : `${(v * 100).toFixed(dp)}%`);

export const STATUS_LABEL: Record<Status, string> = {
  STOCKOUT_RISK: "Stockout risk",
  OVERSTOCK_RISK: "Overstock",
  HEALTHY: "Healthy",
  JUDGMENT_ZONE: "Judgment zone",
};

export const ACTION_LABEL: Record<string, string> = {
  REORDER_NOW: "Reorder now",
  PAUSE_NEXT_ORDER: "Pause next order",
  NEXT_ORDER_1_5X: "Next order 1.5×",
  NORMAL_CYCLE: "Normal cycle",
  RAGHAV_TO_DECIDE: "Raghav to decide",
};

export const FLAG_LABEL: Record<string, string> = {
  R1: "Order still too small",
  R2: "Close to threshold",
  R3: "Festival double-count?",
  R4: "Pushes above max",
  J1: "New launch",
  J2: "Manual override",
  J3: "No demand baseline",
};

export const flagsOf = (s: string) => s.split(";").filter(Boolean);

export const runHref = (r: { id: number; status: string }) => (r.status === "final" ? `/runs/${r.id}/final` : `/runs/${r.id}`);
