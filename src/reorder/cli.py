"""CLI: python -m reorder.cli --input <dir> --config config.yaml --output <dir> [--run-date YYYY-MM-DD]

Exit codes: 0 success, 1 FATAL validation failure, 2 pre-send check failed (RULEBOOK Section 15).
"""
from __future__ import annotations

import argparse
import sys
from datetime import date

from .config import load_config
from .engine import run_plan
from .io import read_dir
from .output import write_outputs


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="reorder")
    p.add_argument("--input", required=True)
    p.add_argument("--config", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--run-date", default=None, help="YYYY-MM-DD, default today")
    a = p.parse_args(argv)
    run_date = date.fromisoformat(a.run_date) if a.run_date else date.today()
    cfg = load_config(a.config)
    res = run_plan(read_dir(a.input), cfg, run_date)
    out = write_outputs(res, a.output)
    if res.fatal:
        for e in res.validation.errors:
            print(e, file=sys.stderr)
    else:
        s = res.summary
        print(
            f"{s['order_month']}: reorder {s['reorder_now']} | pause {s['pause_next_order']} | "
            f"healthy {s['healthy']} | judgment {s['judgment_zone']} | units {s['total_units_now']} | "
            f"review {s['needs_review']} | {'PASSED' if res.for_sending else 'NOT FOR SENDING'}"
        )
        for m in res.check_messages:
            print(m, file=sys.stderr)
    print(f"Output: {out}")
    return res.exit_code


if __name__ == "__main__":
    sys.exit(main())
