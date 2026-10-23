"""ERPNext purchase-order sync (RULEBOOK Section 19.4).

After Raghav approves a plan, each supplier PO is created in ERPNext via its REST API:
  - supplier matched by exact name (distributor_master Distributor_Name == ERPNext Supplier name)
  - items matched by exact item code (sku_master SKU_ID == ERPNext Item code)
  - quantities are the approved quantities; no rate is sent (the data has no prices)
  - "Required By" is the PO date: lead times aren't in the data, so procurement sets the real date
  - the Freshroots PO number goes in the PO title, which makes retries safe
API reference: https://docs.frappe.io/framework/user/en/api/rest
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass

import httpx

REQUIRED_ENV = ["ERPNEXT_URL", "ERPNEXT_API_KEY", "ERPNEXT_API_SECRET", "ERPNEXT_COMPANY"]


class ERPNextError(RuntimeError):
    pass


@dataclass
class ERPNextConfig:
    enabled: bool
    url: str
    api_key: str
    api_secret: str
    company: str
    warehouse: str
    submit: bool

    @classmethod
    def from_env(cls) -> "ERPNextConfig":
        return cls(
            enabled=os.getenv("ERP_SYNC_ENABLED", "false").lower() == "true",
            url=os.getenv("ERPNEXT_URL", "").rstrip("/"),
            api_key=os.getenv("ERPNEXT_API_KEY", ""),
            api_secret=os.getenv("ERPNEXT_API_SECRET", ""),
            company=os.getenv("ERPNEXT_COMPANY", ""),
            warehouse=os.getenv("ERPNEXT_WAREHOUSE", ""),
            submit=os.getenv("ERPNEXT_SUBMIT", "false").lower() == "true",
        )

    @property
    def missing(self) -> list[str]:
        vals = dict(zip(REQUIRED_ENV, [self.url, self.api_key, self.api_secret, self.company]))
        return [k for k, v in vals.items() if not v]

    @property
    def ready(self) -> bool:
        return self.enabled and not self.missing and self.url.startswith("https://")

    def status(self) -> str:
        if not self.enabled:
            return "ERP_SYNC_ENABLED is false"
        if self.missing:
            return f"missing {', '.join(self.missing)}"
        if not self.url.startswith("https://"):
            return "ERPNEXT_URL must start with https://"
        return "ready"


class ERPNextClient:
    def __init__(self, cfg: ERPNextConfig, transport: httpx.BaseTransport | None = None, timeout: float = 20.0):
        if not cfg.ready:
            raise ERPNextError(f"ERPNext is not connected: {cfg.status()}")
        self.cfg = cfg
        self.http = httpx.Client(
            base_url=f"{cfg.url}/api/resource", transport=transport, timeout=timeout,
            headers={"Authorization": f"token {cfg.api_key}:{cfg.api_secret}", "Accept": "application/json"},
        )
        self._suppliers: dict[str, str] = {}
        self._items: set[str] = set()

    def _get(self, doctype: str, filters: list, fields: list[str]) -> list[dict]:
        r = self.http.get(f"/{doctype}", params={"filters": json.dumps(filters), "fields": json.dumps(fields),
                                                  "limit_page_length": 20})
        return _data(r, f"GET {doctype}")

    def supplier(self, name: str) -> str:
        if name not in self._suppliers:
            rows = self._get("Supplier", [["supplier_name", "=", name]], ["name", "supplier_name", "disabled"])
            rows = [r for r in rows if not r.get("disabled")]
            if not rows:
                raise ERPNextError(f"Supplier '{name}' not found in ERPNext (create it with this exact name)")
            self._suppliers[name] = rows[0]["name"]
        return self._suppliers[name]

    def item(self, code: str) -> str:
        if code not in self._items:
            rows = self._get("Item", [["item_code", "=", code]], ["name", "item_code", "disabled"])
            if not [r for r in rows if not r.get("disabled")]:
                raise ERPNextError(f"Item '{code}' not found in ERPNext")
            self._items.add(code)
        return code

    def find_po(self, po_number: str) -> dict | None:
        rows = self._get("Purchase Order", [["title", "=", po_number], ["docstatus", "<", 2]],
                         ["name", "title", "status", "docstatus"])
        return rows[0] if rows else None

    def create_po(self, *, po_number: str, supplier_name: str, date: str, remarks: str, lines: list[dict]) -> dict:
        """Creates the PO (idempotent on our PO number). Returns {name, status, docstatus}."""
        existing = self.find_po(po_number)
        if existing:
            return existing
        doc = {
            "title": po_number,
            "supplier": self.supplier(supplier_name),
            "company": self.cfg.company,
            "transaction_date": date,
            "schedule_date": date,
            "remarks": remarks,
            "items": [{"item_code": self.item(l["sku_id"]), "qty": l["quantity"], "schedule_date": date,
                       **({"warehouse": self.cfg.warehouse} if self.cfg.warehouse else {})} for l in lines],
        }
        if self.cfg.warehouse:
            doc["set_warehouse"] = self.cfg.warehouse
        if self.cfg.submit:
            doc["docstatus"] = 1
        r = self.http.post("/Purchase Order", json=doc)
        return _data(r, "POST Purchase Order")


    def get_po(self, name: str) -> dict:
        return _data(self.http.get(f"/Purchase Order/{name}"), "GET Purchase Order")

    def submit_po(self, name: str, *, rates: dict[str, float], required_by: str) -> dict:
        """Procurement's step, done from the planner: set rates and Required By on the Draft, then submit.

        Rates are typed in by procurement; nothing here computes or changes a quantity.
        """
        doc = self.get_po(name)
        if doc.get("docstatus") != 0:
            raise ERPNextError(f"{name} is already submitted or cancelled in ERPNext")
        items = []
        for it in doc["items"]:
            code = it["item_code"]
            if code not in rates:
                raise ERPNextError(f"No rate given for {code}")
            items.append({**{k: it[k] for k in ("name", "item_code", "qty") if k in it},
                          "rate": rates[code], "schedule_date": required_by})
        _data(self.http.put(f"/Purchase Order/{name}", json={"schedule_date": required_by, "items": items}),
              "update Purchase Order")
        return _data(self.http.put(f"/Purchase Order/{name}", json={"docstatus": 1}), "submit Purchase Order")


def _data(r: httpx.Response, what: str):
    try:
        body = r.json()
    except ValueError:
        body = {}
    if r.status_code >= 400 or "data" not in body:
        msg = body.get("exception") or body.get("message") or body.get("exc_type") or r.text[:200]
        if isinstance(msg, str) and "_server_messages" in body:
            msg = body["_server_messages"][:300]
        raise ERPNextError(f"ERPNext {what} failed ({r.status_code}): {str(msg)[:300]}")
    return body["data"]
