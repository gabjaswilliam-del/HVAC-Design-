# hvac-agent

A standalone maintenance and operations agent system for **one data center per
NVIDIA DGX Spark installation**. The planned product combines an animated CAD-based
monitoring dashboard, an agent harness, a site-configured simulator, cooling
forecasts, an AI pilot, and a curated knowledge base.

**Status:** repository structure only. No application, model, simulator, or equipment
control is implemented yet.

Product scope: [PRODUCT.md](PRODUCT.md) · [中文版](PRODUCT-zh.md).
Module boundaries: [docs/architecture.md](docs/architecture.md).
Reference-project lessons and plan: [docs/reference-review.md](docs/reference-review.md).
Project context for coding agents: [AGENTS.md](AGENTS.md).

## Layout

```text
apps/
  dashboard/              monitoring screen, animated site view, chat, simulation UI
  api/                    local API and application composition
src/hvac_agent/
  core/                   site topology and shared domain contracts
  cad/                    installation-time CAD analysis and 2D scene generation
  agent/                  conversational harness, tools, sessions, agent memory
  simulation/             site-configured simulation using modified PHYVAC
  prediction/             cooling forecasts and site-specific model adaptation
  pilot/                  real-time monitoring and corrections within simulations
  knowledge/              curated knowledge ingestion, retrieval, and RAG
  training/               backbone LLM fine-tuning, RLHF, then RLAIF
  integrations/           adapters for telemetry, model providers, and external engines
configs/site/             versioned configuration examples for a single installation
deployment/dgx-spark/     standalone deployment and operating guidance
scripts/                  setup, maintenance, and validation utilities
tests/                    repository checks; future unit, integration, and evaluation tests
docs/                     architecture and future design decisions
.github/workflows/        CI
```

Each component has a README describing its responsibilities. These are modules in
one repository and one installation, not a requirement to deploy separate services.
The Python package markers establish import paths; they contain no runtime logic.

## Development and validation

Requires Python 3.11 or newer. Runtime dependencies and the frontend framework remain
undecided. The only development dependency is pytest.

Run project tests on the designated DGX Spark as `ghani`; its private connection
details are kept outside version control. Use an isolated checkout and environment:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e ".[dev]"
.venv/bin/python -m pytest
```

GitHub CI also runs the lightweight scaffold check on Python 3.11. It does not
replace DGX validation. Tests live under `tests/`; pytest uses importlib mode to
allow duplicate test basenames in future module-specific test directories.

## Site data and credentials

Keep customer CAD files, telemetry, generated site scenes and sprites, RAG indexes,
model weights, checkpoints, and credentials outside version control. Use ignored
`var/` for installation runtime artifacts and `.local/` for workstation notes and
private configuration. Commit only sanitized examples under `configs/site/`.

The system manages one site's equipment. Multi-site routing, tenant abstractions,
and fleet dashboards are outside the product scope.
