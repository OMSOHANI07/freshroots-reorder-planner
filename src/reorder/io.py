"""Input loading and schema (RULEBOOK Section 5)."""
from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

REQUIRED_FILES: dict[str, list[str]] = {
    "weekly_sales.csv": ["SKU_ID", "Week", "Units_Sold"],
    "sku_master.csv": [
        "SKU_ID", "SKU_Name", "Category", "Perishability",
        "Standard_Reorder_Qty", "Unit_of_Measure", "Distributor_ID",
    ],
    "current_inventory.csv": ["SKU_ID", "Location", "Units_On_Hand", "As_Of_Date"],
    "calendar.csv": ["Year", "Month", "Year_Month", "Is_Festival_Month"],
    "distributor_master.csv": ["Distributor_ID", "Distributor_Name", "Region", "Status"],
}
OPTIONAL_FILES: dict[str, list[str]] = {
    "judgment_overrides.csv": ["SKU_ID", "Reason", "Entered_By", "Valid_Until"],
}


@dataclass
class InputFile:
    name: str
    raw: bytes
    frame: pd.DataFrame | None  # None when it could not be parsed
    sha256: str
    parse_error: str | None = None

    @property
    def row_count(self) -> int:
        return 0 if self.frame is None else len(self.frame)


def parse_csv(name: str, raw: bytes) -> InputFile:
    """Read every column as a trimmed string; typing happens in validation."""
    digest = hashlib.sha256(raw).hexdigest()
    try:
        text = raw.decode("utf-8-sig")
        df = pd.read_csv(io.StringIO(text), dtype=str, keep_default_na=False, skipinitialspace=False)
        df.columns = [c.strip() for c in df.columns]
        for c in df.columns:
            df[c] = df[c].astype(str).str.strip()
        return InputFile(name, raw, df, digest)
    except Exception as exc:  # malformed file -> I1
        return InputFile(name, raw, None, digest, parse_error=str(exc))


def load_bytes(files: dict[str, bytes]) -> dict[str, InputFile]:
    return {name: parse_csv(name, raw) for name, raw in files.items()}


def read_dir(path: str | Path) -> dict[str, bytes]:
    """Collect the known input files present in a directory."""
    p = Path(path)
    out: dict[str, bytes] = {}
    for name in [*REQUIRED_FILES, *OPTIONAL_FILES]:
        f = p / name
        if f.exists():
            out[name] = f.read_bytes()
    return out
