"""config.yaml loading (RULEBOOK Section 6). No defaults live in code."""
from __future__ import annotations

import hashlib
from pathlib import Path

import yaml

REQUIRED_KEYS = [
    "short_window_weeks",
    "long_window_weeks",
    "high_demand_threshold",
    "high_demand_multiplier",
    "festival_uplift",
    "cover_window",
    "close_call_band_weeks",
    "min_history_weeks",
    "inventory_max_age_days",
    "order_qty_rounding",
]
ROUNDING_MODES = {"ceil", "floor", "round_half_up"}


class ConfigError(ValueError):
    pass


def load_config_text(text: str) -> dict:
    cfg = yaml.safe_load(text) or {}
    missing = [k for k in REQUIRED_KEYS if k not in cfg]
    if missing:
        raise ConfigError(f"config.yaml missing keys: {', '.join(missing)}")
    for level in ("Low", "High"):
        win = cfg["cover_window"].get(level)
        if not win or "min_weeks" not in win or "max_weeks" not in win:
            raise ConfigError(f"config.yaml cover_window.{level} needs min_weeks and max_weeks")
    if cfg["order_qty_rounding"] not in ROUNDING_MODES:
        raise ConfigError(f"order_qty_rounding must be one of {sorted(ROUNDING_MODES)}")
    cfg["_text"] = text
    cfg["_sha256"] = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return cfg


def load_config(path: str | Path) -> dict:
    return load_config_text(Path(path).read_text(encoding="utf-8"))


def rulebook_version(path: str | Path) -> str:
    """Read the '**Version:** x' line from RULEBOOK.md for run stamping."""
    p = Path(path)
    if not p.exists():
        return "unknown"
    for line in p.read_text(encoding="utf-8").splitlines():
        if line.startswith("**Version:**"):
            return line.replace("**Version:**", "").strip()
    return "unknown"
