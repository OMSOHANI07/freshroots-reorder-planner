"""Vercel Python entry point: serves the FastAPI app under /api."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from planner_api.main import app  # noqa: E402,F401
