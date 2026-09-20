# Project context and working agreements

Updated from the owner's project definition on 2026-09-20. Read [PRODUCT.md](PRODUCT.md)
and [docs/architecture.md](docs/architecture.md) before making architectural changes.

## What we are building

- A data-center maintenance and operations agent system/harness with an integrated
  dashboard. Data centers are the primary use case, including their HVAC systems.
- One standalone NVIDIA DGX Spark installation serves exactly one data center.
  Do not add multi-site, fleet, tenant, or cloud-control-plane abstractions.
- Installation-time AI CAD analysis produces a 2D design scene and equipment
  topology. Image-model integration generates sprites and animation assets. The
  animated site scene becomes the dashboard's primary monitoring screen.
- An interactive agent harness, inspired by OpenClaw/Codex/Claude Code, answers
  site questions and calls tools. No particular framework is selected.
- A shipped simulator is configured from the CAD topology and verified site
  parameters to represent the actual pump station; operators run it on demand.
- A separate cooling prediction model is trained/adapted during installation when
  historical data exists. Otherwise use our pretrained model with site configuration.
- An HVAC-informed AI pilot monitors in real time and detects/corrects anomalies
  while simulations run. Corrections target the simulation; physical equipment
  actuation remains a separate, undefined design scope.
- The backbone LLM is intended to specialize in data centers through domain
  fine-tuning, RLHF, then later RLAIF. Do not claim training or specialization is
  already complete. Keep this separate from site-specific forecast adaptation.
- We build the curated RAG knowledge base. Keep retrieval knowledge separate from
  conversation memory, telemetry history, and training datasets.

## Current scope and implementation boundaries

- The initial request is **folder structure and documentation only**, followed by
  a PR. Do not implement the entire system as part of scaffolding.
- Backend modules live under `src/hvac_agent/`; entry points under `apps/` compose
  them. See the architecture document for dependency direction and ownership.
- `core` owns shared domain contracts, not provider clients or application logic.
- Keep provider-specific integrations behind adapters. Do not choose frameworks,
  databases, model families, or simulator engines just to populate empty folders.
- Modules need not be microservices. The target is a single local installation.
- Report missing telemetry, unavailable tools, and prediction uncertainty explicitly.

## Testing and private environment

- Use the owner's designated DGX Spark for project testing, logging in as `ghani`.
  Use an isolated checkout/virtual environment; do not overwrite existing deployments.
- Local connection details, when available, are in ignored `.local/dgx-spark.md`.
  The owner supplied credentials for the session; do not copy passwords into
  tracked files, documentation, commit messages, PRs, or test output.
- Lightweight GitHub CI is a supplementary scaffold check, not a substitute for
  testing on the DGX Spark. State clearly if DGX validation could not be completed.
- Keep customer CAD, telemetry, generated site assets, retrieval indexes, training
  data, model weights, and secrets out of Git. Use ignored local/runtime storage.
- Run checks appropriate to the change and report what was actually verified.

## Maintaining this context

Keep this file, both product descriptions, module READMEs, and the architecture
document consistent when the owner changes product scope. This file is durable
project context; session-only credentials are deliberately not durable memory.
