"""Zoho Inventory purchase-order sync (RULEBOOK v1.2).

After Raghav approves a plan, each supplier PO is created in Zoho Inventory:
  - vendor matched by exact name (distributor_master Distributor_Name == Zoho vendor contact_name)
  - items matched by exact SKU (sku_master SKU_ID == Zoho item sku)
  - quantities are Raghav's approved quantities; no rate is sent (the data has no prices)
API reference: https://www.zoho.com/inventory/api/v1/ (purchaseorders, contacts, items, oauth).
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass

import httpx

DC_DOMAINS = {  # data center -> (api domain, accounts domain)
    "com": ("www.zohoapis.com", "accounts.zoho.com"),
    "in": ("www.zohoapis.in", "accounts.zoho.in"),
    "eu": ("www.zohoapis.eu", "accounts.zoho.eu"),
    "com.au": ("www.zohoapis.com.au", "accounts.zoho.com.au"),
    "jp": ("www.zohoapis.jp", "accounts.zoho.jp"),
    "ca": ("www.zohoapis.ca", "accounts.zohocloud.ca"),
    "sa": ("www.zohoapis.sa", "accounts.zoho.sa"),
}
REQUIRED_ENV = ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN", "ZOHO_ORGANIZATION_ID"]


class ZohoError(RuntimeError):
    pass


@dataclass
class ZohoConfig:
    enabled: bool
    dc: str
    client_id: str
    client_secret: str
    refresh_token: str
    organization_id: str
    mark_issued: bool

    @classmethod
    def from_env(cls) -> "ZohoConfig":
        return cls(
            enabled=os.getenv("ZOHO_SYNC_ENABLED", "false").lower() == "true",
            dc=os.getenv("ZOHO_DC", "in"),
            client_id=os.getenv("ZOHO_CLIENT_ID", ""),
            client_secret=os.getenv("ZOHO_CLIENT_SECRET", ""),
            refresh_token=os.getenv("ZOHO_REFRESH_TOKEN", ""),
            organization_id=os.getenv("ZOHO_ORGANIZATION_ID", ""),
            mark_issued=os.getenv("ZOHO_MARK_ISSUED", "false").lower() == "true",
        )

    @property
    def missing(self) -> list[str]:
        vals = dict(zip(REQUIRED_ENV, [self.client_id, self.client_secret, self.refresh_token, self.organization_id]))
        return [k for k, v in vals.items() if not v]

    @property
    def ready(self) -> bool:
        return self.enabled and not self.missing and self.dc in DC_DOMAINS

    def status(self) -> str:
        if not self.enabled:
            return "ZOHO_SYNC_ENABLED is false"
        if self.dc not in DC_DOMAINS:
            return f"ZOHO_DC '{self.dc}' is not one of {', '.join(DC_DOMAINS)}"
        if self.missing:
            return f"missing {', '.join(self.missing)}"
        return "ready"


class ZohoClient:
    def __init__(self, cfg: ZohoConfig, transport: httpx.BaseTransport | None = None, timeout: float = 20.0):
        if not cfg.ready:
            raise ZohoError(f"Zoho is not connected: {cfg.status()}")
        self.cfg = cfg
        api, accounts = DC_DOMAINS[cfg.dc]
        self.api_base = f"https://{api}/inventory/v1"
        self.token_url = f"https://{accounts}/oauth/v2/token"
        self.http = httpx.Client(transport=transport, timeout=timeout)
        self._token: str | None = None
        self._token_exp = 0.0
        self._vendors: dict[str, str] = {}
        self._items: dict[str, str] = {}

    # ---- auth ----
    def token(self) -> str:
        if self._token and time.time() < self._token_exp - 60:
            return self._token
        r = self.http.post(self.token_url, data={
            "refresh_token": self.cfg.refresh_token, "client_id": self.cfg.client_id,
            "client_secret": self.cfg.client_secret, "grant_type": "refresh_token",
        })
        body = _json(r)
        if "access_token" not in body:
            raise ZohoError(f"Zoho OAuth refresh failed: {body.get('error', r.status_code)}")
        self._token = body["access_token"]
        self._token_exp = time.time() + float(body.get("expires_in", 3600))
        return self._token

    def _req(self, method: str, path: str, params: dict | None = None, json: dict | None = None) -> dict:
        p = {"organization_id": self.cfg.organization_id, **(params or {})}
        r = self.http.request(method, f"{self.api_base}{path}", params=p, json=json,
                              headers={"Authorization": f"Zoho-oauthtoken {self.token()}"})
        body = _json(r)
        if r.status_code >= 400 or body.get("code", 0) != 0:
            raise ZohoError(f"Zoho {method} {path} failed ({r.status_code}): {body.get('message', 'no message')}")
        return body

    # ---- lookups ----
    def vendor_id(self, name: str) -> str:
        if name in self._vendors:
            return self._vendors[name]
        body = self._req("GET", "/contacts", {"contact_name": name})
        matches = [c for c in body.get("contacts", [])
                   if c.get("contact_type") == "vendor" and c.get("contact_name", "").strip().lower() == name.strip().lower()]
        if not matches:
            raise ZohoError(f"Vendor '{name}' not found in Zoho Inventory (create it with this exact name)")
        self._vendors[name] = matches[0]["contact_id"]
        return self._vendors[name]

    def item_id(self, sku: str) -> str:
        if sku in self._items:
            return self._items[sku]
        body = self._req("GET", "/items", {"sku": sku})
        matches = [i for i in body.get("items", []) if str(i.get("sku", "")).strip() == sku]
        if not matches:
            raise ZohoError(f"Item with SKU '{sku}' not found in Zoho Inventory")
        self._items[sku] = matches[0]["item_id"]
        return self._items[sku]

    def find_po(self, po_number: str) -> dict | None:
        body = self._req("GET", "/purchaseorders", {"search_text": po_number})
        for po in body.get("purchaseorders", []):
            if po.get("purchaseorder_number") == po_number:
                return po
        return None

    # ---- create ----
    def create_po(self, *, po_number: str, vendor_name: str, date: str, reference: str, notes: str,
                  lines: list[dict]) -> dict:
        """Creates the PO (idempotent on our PO number). Returns {purchaseorder_id, purchaseorder_number, status}."""
        existing = self.find_po(po_number)
        if existing:
            return existing
        payload = {
            "purchaseorder_number": po_number,
            "vendor_id": self.vendor_id(vendor_name),
            "date": date,
            "reference_number": reference,
            "notes": notes,
            "line_items": [{"item_id": self.item_id(l["sku_id"]), "quantity": l["quantity"]} for l in lines],
        }
        body = self._req("POST", "/purchaseorders", {"ignore_auto_number_generation": "true"}, payload)
        po = body.get("purchase_order") or body.get("purchaseorder") or {}
        if self.cfg.mark_issued and po.get("purchaseorder_id"):
            self._req("POST", f"/purchaseorders/{po['purchaseorder_id']}/status/issued")
            po["status"] = "issued"
        return po


def _json(r: httpx.Response) -> dict:
    try:
        return r.json()
    except ValueError:
        return {"message": r.text[:200]}
