"""API, whole-plan approval, PO and Zoho sync tests. Throwaway SQLite DB and a mock Zoho; never Neon or real Zoho."""
import csv
import io
import json
import zipfile

import httpx
import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from pypdf import PdfReader

from planner_api import db, main
from planner_api.main import app
from planner_api.settings import get_settings
from reorder.io import read_dir

ANALYST = {"X-Role": "analyst"}
RAGHAV = {"X-Role": "raghav"}
PROC = {"X-Role": "procurement"}
EXPECTED = {"DIST001": {"SKU001": 750, "SKU013": 120}, "DIST002": {"SKU003": 300, "SKU004": 150},
            "DIST004": {"SKU011": 500}}
VENDORS = {"NutriFlow Distributors": "V1", "GrainPath Logistics": "V2", "Meridian Trade Co.": "V4"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    db.init_engine(f"sqlite:///{tmp_path / 'test.db'}")
    monkeypatch.setattr(get_settings(), "gemini_api_key", "")  # template explanations, no network
    for k in ("ZOHO_SYNC_ENABLED", "ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN", "ZOHO_ORGANIZATION_ID"):
        monkeypatch.delenv(k, raising=False)
    return TestClient(app)


class FakeZoho:
    """Minimal Zoho Inventory: OAuth refresh, contacts, items, purchase orders."""

    def __init__(self, fail_vendor=None):
        self.created, self.fail_vendor, self.tokens = [], fail_vendor, 0

    def __call__(self, req: httpx.Request) -> httpx.Response:
        url = req.url
        if url.path == "/oauth/v2/token":
            self.tokens += 1
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 3600})
        assert req.headers["Authorization"] == "Zoho-oauthtoken tok"
        assert url.params["organization_id"] == "org1"
        if url.path.endswith("/contacts"):
            name = url.params["contact_name"]
            if name == self.fail_vendor or name not in VENDORS:
                return httpx.Response(200, json={"code": 0, "contacts": []})
            return httpx.Response(200, json={"code": 0, "contacts": [
                {"contact_id": VENDORS[name], "contact_name": name, "contact_type": "vendor"}]})
        if url.path.endswith("/items"):
            sku = url.params["sku"]
            return httpx.Response(200, json={"code": 0, "items": [{"item_id": f"I-{sku}", "sku": sku}]})
        if url.path.endswith("/purchaseorders") and req.method == "GET":
            found = [c for c in self.created if c["purchaseorder_number"] == url.params["search_text"]]
            return httpx.Response(200, json={"code": 0, "purchaseorders": [
                {"purchaseorder_id": f"Z{c['purchaseorder_number']}", "purchaseorder_number": c["purchaseorder_number"],
                 "status": "draft"} for c in found]})
        if url.path.endswith("/purchaseorders") and req.method == "POST":
            assert url.params["ignore_auto_number_generation"] == "true"
            body = json.loads(req.content)
            self.created.append(body)
            return httpx.Response(201, json={"code": 0, "purchase_order": {
                "purchaseorder_id": f"Z{body['purchaseorder_number']}", "purchaseorder_number": body["purchaseorder_number"],
                "status": "draft"}})
        return httpx.Response(404, json={"code": 1, "message": "unexpected"})


def connect_zoho(monkeypatch, fake):
    for k, v in {"ZOHO_SYNC_ENABLED": "true", "ZOHO_DC": "in", "ZOHO_CLIENT_ID": "c", "ZOHO_CLIENT_SECRET": "s",
                 "ZOHO_REFRESH_TOKEN": "r", "ZOHO_ORGANIZATION_ID": "org1"}.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setattr(main, "_zoho_transport", httpx.MockTransport(fake))


def upload(client, oct_dir, run_date="2026-10-19", headers=ANALYST, drop=None):
    files = [("files", (n, b, "text/csv")) for n, b in read_dir(oct_dir).items() if n != drop]
    return client.post("/api/runs", files=files, data={"run_date": run_date}, headers=headers)


def test_roles(client, oct_dir):
    assert upload(client, oct_dir, headers=RAGHAV).status_code == 403   # Raghav doesn't run plans
    assert upload(client, oct_dir, headers=PROC).status_code == 403
    assert client.get("/api/runs").status_code == 401
    run_id = upload(client, oct_dir).json()["run_id"]
    assert client.post(f"/api/runs/{run_id}/approve", headers=ANALYST).status_code == 403
    assert client.post(f"/api/runs/{run_id}/approve", headers=PROC).status_code == 403


def test_fatal_returns_exact_messages(client, oct_dir):
    r = upload(client, oct_dir, run_date="2026-10-30")
    assert r.status_code == 422
    assert "I7: inventory snapshot is stale or future-dated: 2026-10-19" in r.json()["validation"]["errors"]
    r = upload(client, oct_dir, drop="calendar.csv")
    assert "I1: missing file or column: calendar.csv" in r.json()["validation"]["errors"]


def test_fetch_latest_sap_data(client, oct_dir):
    r = client.post("/api/runs", data={"source": "sap_latest", "run_date": "2026-10-19"}, headers=ANALYST)
    assert r.status_code == 409  # nothing uploaded yet
    first = upload(client, oct_dir).json()["run_id"]
    info = client.get("/api/sap/latest", headers=ANALYST).json()
    assert info["run_id"] == first and len(info["files"]) == 5
    r = client.post("/api/runs", data={"source": "sap_latest", "run_date": "2026-10-19"}, headers=ANALYST)
    assert r.status_code == 200, r.text
    d = client.get(f"/api/runs/{r.json()['run_id']}", headers=ANALYST).json()
    assert d["source"] == "sap_latest" and d["source_run_id"] == first
    assert d["summary"]["total_units_now"] == 1820
    assert [f["sha256"] for f in d["files"]] == [f["sha256"] for f in info["files"]]


def test_reject_needs_note_and_makes_no_pos(client, oct_dir):
    run_id = upload(client, oct_dir).json()["run_id"]
    assert client.post(f"/api/runs/{run_id}/reject", headers=RAGHAV, json={"note": " "}).status_code == 422
    r = client.post(f"/api/runs/{run_id}/reject", headers=RAGHAV, json={"note": "Festival uplift looks double-counted"})
    assert r.json()["status"] == "rejected"
    assert client.get(f"/api/runs/{run_id}/pos", headers=PROC).json() == []
    assert client.post(f"/api/runs/{run_id}/approve", headers=RAGHAV).status_code == 409


def test_approve_without_zoho_keeps_pos_and_reason(client, oct_dir):
    run_id = upload(client, oct_dir).json()["run_id"]
    pos = client.post(f"/api/runs/{run_id}/approve", headers=RAGHAV).json()["pos"]
    assert {p["distributor_id"]: {l["sku_id"]: l["quantity"] for l in p["lines"]} for p in pos} == EXPECTED
    assert all(p["status"] == "Generated" and "Zoho not connected" in p["zoho_error"] for p in pos)


def test_approve_creates_pos_in_zoho(client, oct_dir, monkeypatch):
    fake = FakeZoho()
    connect_zoho(monkeypatch, fake)
    run_id = upload(client, oct_dir).json()["run_id"]
    assert client.post(f"/api/runs/{run_id}/explain", headers=ANALYST).status_code == 200
    r = client.post(f"/api/runs/{run_id}/approve", headers=RAGHAV, json={"note": "Looks right"})
    assert r.status_code == 200, r.text
    pos = r.json()["pos"]
    assert all(p["status"] == "Entered in Zoho" and p["zoho_po_id"] and p["zoho_error"] is None for p in pos)
    # Zoho received exactly the approved quantities, one PO per supplier, mapped vendors + items, no prices
    got = {c["vendor_id"]: {l["item_id"]: l["quantity"] for l in c["line_items"]} for c in fake.created}
    assert got == {VENDORS["NutriFlow Distributors"]: {"I-SKU001": 750, "I-SKU013": 120},
                   VENDORS["GrainPath Logistics"]: {"I-SKU003": 300, "I-SKU004": 150},
                   VENDORS["Meridian Trade Co."]: {"I-SKU011": 500}}
    assert all("rate" not in l and "purchase_rate" not in l for c in fake.created for l in c["line_items"])
    assert {c["purchaseorder_number"] for c in fake.created} == {p["po_number"] for p in pos}
    assert fake.tokens == 1  # token reused across POs
    audit = client.get(f"/api/audit?run_id={run_id}", headers=PROC).json()
    assert sum(a["action"] == "po.zoho_created" for a in audit) == 3
    # manual "entered" is blocked once Zoho has it
    assert client.patch(f"/api/pos/{pos[0]['id']}", headers=PROC,
                        json={"status": "Entered in Zoho", "zoho_ref": "x"}).status_code == 409


def test_zoho_failure_then_retry(client, oct_dir, monkeypatch):
    fake = FakeZoho(fail_vendor="GrainPath Logistics")
    connect_zoho(monkeypatch, fake)
    run_id = upload(client, oct_dir).json()["run_id"]
    pos = {p["distributor_id"]: p for p in client.post(f"/api/runs/{run_id}/approve", headers=RAGHAV).json()["pos"]}
    assert pos["DIST001"]["status"] == "Entered in Zoho"
    assert pos["DIST002"]["status"] == "Zoho sync failed"
    assert "Vendor 'GrainPath Logistics' not found" in pos["DIST002"]["zoho_error"]
    assert client.post(f"/api/pos/{pos['DIST002']['id']}/zoho-sync", headers=RAGHAV).status_code == 403
    fake.fail_vendor = None  # vendor created in Zoho
    again = client.post(f"/api/pos/{pos['DIST002']['id']}/zoho-sync", headers=PROC).json()
    assert again["status"] == "Entered in Zoho"
    # retry of an already-synced PO doesn't create a duplicate
    client.post(f"/api/pos/{pos['DIST001']['id']}/zoho-sync", headers=PROC)
    assert len(fake.created) == 3


def test_po_files(client, oct_dir):
    run_id = upload(client, oct_dir).json()["run_id"]
    pos = client.post(f"/api/runs/{run_id}/approve", headers=RAGHAV).json()["pos"]
    for p in pos:
        assert p["total_qty"] == sum(l["quantity"] for l in p["lines"])
        assert p["po_number"].startswith("FR-PO-") and p["po_number"].endswith(f"-{p['distributor_id']}-001")
    assert not {l["sku_id"] for p in pos for l in p["lines"]} & {"SKU006", "SKU007"}
    pdf = client.get(f"/api/runs/{run_id}/pos/download?format=pdf", headers=PROC)
    reader = PdfReader(io.BytesIO(pdf.content))
    assert len(reader.pages) == 3
    text = "".join(pg.extract_text() for pg in reader.pages)
    assert "Raghav Kulkarni" in text and "Generated by Freshroots Reorder Planner. Enter in Zoho Inventory." in text
    wb = load_workbook(io.BytesIO(client.get(f"/api/runs/{run_id}/pos/download?format=xlsx", headers=PROC).content))
    assert wb.sheetnames[0] == "Summary" and wb.sheetnames[-1] == "Approval Log" and len(wb.sheetnames) == 5
    rows = list(csv.DictReader(io.StringIO(client.get(f"/api/runs/{run_id}/pos/download?format=csv", headers=PROC).text)))
    assert sum(int(r["Quantity"]) for r in rows) == 1820
    z = zipfile.ZipFile(io.BytesIO(client.get(f"/api/runs/{run_id}/pos/download?format=zip", headers=PROC).content))
    assert z.testzip() is None and "plan/reorder_plan_2026-10.csv" in z.namelist()


def test_plan_files_match_engine(client, oct_dir):
    run_id = upload(client, oct_dir).json()["run_id"]
    csv_text = client.get(f"/api/runs/{run_id}/plan?format=csv", headers=RAGHAV).text
    assert ",750,0,6.14,0,R3," in csv_text


def test_master_data_tables(client, oct_dir):
    assert client.get("/api/master", headers=PROC).json() is None
    run_id = upload(client, oct_dir).json()["run_id"]
    m = client.get("/api/master", headers=PROC).json()
    assert m["run_id"] == run_id
    assert len(m["skus"]) == 15 and len(m["suppliers"]) == 4 and len(m["calendar"]) == 24
    sku1 = next(k for k in m["skus"] if k["sku_id"] == "SKU001")
    assert (sku1["supplier_name"], sku1["units_on_hand"], sku1["standard_reorder_qty"]) == ("NutriFlow Distributors", 900, 500)
    assert [h["week"] for h in sku1["sales"]][-1] == "2026-W42" and len(sku1["sales"]) == 16
    assert {c["year_month"] for c in m["calendar"] if c["is_festival_month"]} >= {"2026-03", "2026-10", "2026-11"}
    # a run on the latest SAP data doesn't duplicate master rows
    client.post("/api/runs", data={"source": "sap_latest", "run_date": "2026-10-19"}, headers=ANALYST)
    with db._Session() as s:
        from sqlalchemy import func, select
        assert s.scalar(select(func.count()).select_from(db.SkuMaster)) == 15
        assert s.scalar(select(func.count()).select_from(db.WeeklySales)) == 240


def test_backfill_master_data(client, oct_dir):
    run_id = upload(client, oct_dir).json()["run_id"]
    with db._Session() as s:
        from sqlalchemy import delete
        for t in (db.SkuMaster, db.DistributorMaster, db.WeeklySales, db.CurrentInventory, db.FestivalCalendar):
            s.execute(delete(t))
        s.commit()
    db._backfill_master_data()
    assert client.get("/api/master", headers=PROC).json()["run_id"] == run_id
    assert len(client.get("/api/master", headers=PROC).json()["skus"]) == 15
