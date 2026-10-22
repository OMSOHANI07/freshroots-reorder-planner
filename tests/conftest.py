from pathlib import Path

import pytest

from reorder.config import load_config

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session")
def cfg():
    return load_config(ROOT / "config.yaml")


@pytest.fixture(scope="session")
def oct_dir():
    return ROOT / "tests" / "fixtures" / "oct_2026"
