# hvac-agent

An LLM agent that helps chiller-plant operators run their plant. It answers questions
about the plant and recommends what to do; a human decides and acts.

Product description: `PRODUCT.md` (中文：`PRODUCT-zh.md`).

## Layout

agent/          the agent loop — question in, answer + recommendation out
prediction/     cooling-load forecasting
cad/            CAD drawing → 2D plant view, runs once per install
training/       model training, RLHF / RLAIF
.github/        CI workflow

PRODUCT.md      what we are building and why (中文：PRODUCT-zh.md)
pyproject.toml  Python version, dependencies, dev tools
test_smoke.py   placeholder so that pytest and CI have something to run
.gitignore      what must never be committed — plant data and credentials above all

Each folder has a README saying what belongs in it.

## Getting started

Requires Python 3.11 or newer.

```sh
pip install -e ".[dev]"
pytest
```

CI runs those same two commands on every push and pull request. There are no runtime
dependencies yet — `pyproject.toml` declares only pytest, and the one test just checks
that the folders above exist.

Tests live with the code they cover — `agent/tests/`, `prediction/tests/`, and so on.
`pytest` finds them with no configuration. Give test files unique names across folders
(`test_agent_utils.py`, not a second `test_utils.py`), or collection fails on the
duplicate module name.

## Data and credentials

No plant data, no BMS exports, no customer CAD drawings, no credentials, no model
weights. None of it belongs in this repo, and `.gitignore` blocks the common shapes of
each. What data belongs here, if any, is still open (`PRODUCT.md` §7) — committing
something the ignore rules block is a decision to make deliberately and write down.

## Status

Nothing runs yet.
