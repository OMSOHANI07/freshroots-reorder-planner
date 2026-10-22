export type Status = "STOCKOUT_RISK" | "OVERSTOCK_RISK" | "HEALTHY" | "JUDGMENT_ZONE";
export type DecisionKind = "APPROVE" | "CHANGE" | "REJECT" | "HOLD";

export interface Summary {
  order_month: string;
  is_festival: boolean;
  as_of_date: string;
  reference_week: string;
  skus_total: number;
  reorder_now: number;
  pause_next_order: number;
  healthy: number;
  judgment_zone: number;
  total_units_now: number;
  needs_review: number;
  for_sending: boolean;
}

export interface RunBrief {
  id: number;
  created_at: string;
  created_at_local: string;
  created_by: string;
  run_date: string;
  status: "failed" | "draft" | "final" | "rejected";
  order_month: string | null;
  summary: Summary | null;
  rulebook_version: string;
  config_sha256: string;
  decided: number;
  sku_count: number;
  source: "upload" | "sap_latest";
  source_run_id: number | null;
  review_note: string | null;
  finalised_at: string | null;
  finalised_at_local: string | null;
  finalised_by: string | null;
}

export interface Decision {
  decision: DecisionKind;
  final_qty: number;
  note: string | null;
  decided_by: string;
  decided_at: string;
  decided_at_local: string;
}

export interface Explanation {
  summary: string;
  why: string;
  what_to_check: string | null;
  source: "gemini" | "template";
}

export interface Line {
  sku_id: string;
  sku_name: string;
  category: string;
  perishability: "High" | "Low";
  supplier_name: string;
  std_qty: number;
  units_on_hand: number;
  avg4: number | null;
  avg12: number | null;
  trend: number | null;
  high_demand: boolean | null;
  is_festival: boolean;
  forward_demand: number | null;
  cover_weeks: number | null;
  min_weeks: number;
  max_weeks: number;
  status: Status;
  action: string;
  order_qty_now: number;
  next_cycle_qty: number;
  cover_after: number | null;
  shortfall_units: number;
  review_flags: string;
  review_note: string;
  needs_raghav_review: boolean;
  uom: string;
  distributor_id: string;
  supplier_region: string;
  history: { week: string; units: number }[];
  rules_fired: string[];
  decision: Decision | null;
  explanation: Explanation | null;
}

export interface Validation {
  checks: Record<string, boolean>;
  errors: string[];
  warnings: string[];
  pre_send: Record<string, boolean>;
  pre_send_messages: string[];
}

export interface RunDetail extends RunBrief {
  validation: Validation;
  lines: Line[];
  procurement_note: string | null;
  procurement_note_source: "gemini" | "template" | null;
  files: { name: string; sha256: string; rows: number }[];
  config_text: string;
}

export interface POLine {
  sku_id: string;
  sku_name: string;
  uom: string;
  quantity: number;
  decision_source: "APPROVE" | "CHANGE";
  engine_qty: number;
}

export interface PO {
  id: number;
  run_id: number;
  po_number: string;
  distributor_id: string;
  supplier_name: string;
  supplier_region: string;
  po_date: string;
  status: "Generated" | "Downloaded" | "Entered in Zoho" | "Zoho sync failed";
  zoho_ref: string | null;
  zoho_po_id: string | null;
  zoho_status: string | null;
  zoho_error: string | null;
  total_qty: number;
  lines: POLine[];
}

export interface AuditEntry {
  id: number;
  ts: string;
  ts_local: string;
  actor: string;
  action: string;
  run_id: number | null;
  entity: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}
