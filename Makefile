.PHONY: setup dev api web test e2e plan

PY ?= .venv/bin/python

setup:
	uv venv --python 3.11 .venv || python3.11 -m venv .venv
	uv pip install --python $(PY) -r requirements-dev.txt || $(PY) -m pip install -r requirements-dev.txt
	npm install

api:
	PYTHONPATH=src $(PY) -m uvicorn planner_api.main:app --reload --port 8000

web:
	npm run dev

# Runs both servers: API on :8000, site on :3000
dev:
	$(MAKE) -j2 api web

test:
	$(PY) -m pytest -q

e2e:
	npx playwright test

# RULEBOOK CLI on the October fixture
plan:
	PYTHONPATH=src $(PY) -m reorder.cli --input tests/fixtures/oct_2026 --config config.yaml --output output --run-date 2026-10-19
