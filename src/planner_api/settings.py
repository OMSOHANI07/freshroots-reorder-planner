"""Environment settings. Keys are read from env and never logged."""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")


class Settings:
    def __init__(self) -> None:
        self.gemini_api_key = os.getenv("GEMINI_API_KEY", "")
        self.gemini_model = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
        self.database_url = os.getenv("DATABASE_URL", "")
        self.zoho_sync_enabled = os.getenv("ZOHO_SYNC_ENABLED", "false").lower() == "true"
        self.timezone = ZoneInfo(os.getenv("APP_TIMEZONE", "Asia/Kolkata"))
        self.company_name = os.getenv("COMPANY_NAME", "Freshroots")
        self.company_address = os.getenv("COMPANY_ADDRESS", "")
        self.config_path = ROOT / "config.yaml"
        self.rulebook_path = ROOT / "RULEBOOK.md"


@lru_cache
def get_settings() -> Settings:
    return Settings()
