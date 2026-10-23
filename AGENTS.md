# Project context and working agreements

Updated from the owner's project definition on 2026-09-20; implementation authorization
for stages 1 and 2 added 2026-09-21. Read [PRODUCT.md](PRODUCT.md)
and [docs/architecture.md](docs/architecture.md) before making architectural changes.
Reference-project findings and the development sequence are in
[docs/reference-review.md](docs/reference-review.md).
Read [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) for the portable LLM context prompt,
including branch-specific implementation status, review findings, and remaining work.
Verify its dated snapshot against the current checkout and relevant PR before relying
on it; implementation on an open PR is not implementation merged into this branch.

## What we are building

- A data-center maintenance and operations agent system/harness with an integrated
  dashboard. Data centers are the primary use case, including their HVAC systems.
- One standalone NVIDIA DGX Spark installation serves exactly one data center.
  Do not add multi-site, fleet, tenant, or cloud-control-plane abstractions.
- The complete product is local to that DGX: dashboard/API hosting, LLM and image
  models, embeddings, RAG, memory, databases, modified PHYVAC, prediction, and pilot.
  Installation, asset generation, adaptation, and planned training jobs also target
  the DGX. Do not introduce a required cloud API, second compute host, or remote
  database. Local site equipment and operator browsers may connect over the LAN.
- Ship a repeatable installation and commissioning procedure, followed by managed
  startup/restart, upgrades, and backup/restore. See `deployment/dgx-spark/README.md`.
  This is an installable standalone product, not a collection of manually started
  developer services. Installer implementation remains future work.
- Installation-time AI CAD analysis produces a 2D design scene and equipment
  topology. Image-model integration generates sprites and animation assets. The
  animated site scene becomes the dashboard's primary monitoring screen.
- An interactive agent harness, inspired by OpenClaw/Codex/Claude Code, answers
  site questions and calls tools. No particular framework is selected.
- A shipped simulator is configured from the CAD topology and verified site
  parameters to represent the actual pump station; operators run it on demand.
  **Use a modified version of PHYVAC** as the simulation foundation. This is an
  owner decision, not an open engine choice. The fork, revision, and modifications
  still need to be specified; isolate engine-specific code behind an adapter.
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
- `../openclaw-hvac` is a low-quality reference prototype. Study its workflows and
  lessons, but do not copy its implementation, assets, configuration, prompts, or
  deployment assumptions. Its multi-station behavior and remote replay backend are
  not requirements for this single-site product. Do not modify that reference repo.
- Preserve the useful ideas: editable semantic CAD design, agent-driven data views,
  stable equipment IDs, explicit simulation lifecycle, evidence-backed diagnosis,
  issue/outcome history, and measured forecast/controller comparisons. Do not treat
  a generated schematic or the prototype's reported scores as validated site fidelity.

## Current scope and implementation boundaries

- Scaffolding and reference review did not themselves authorize feature development.
  As of 2026-09-21 the owner authorizes stages 1 and 2 of the sequence in
  [docs/reference-review.md](docs/reference-review.md): site definition contracts and
  the modified PHYVAC foundation. Work under this authorization is confined to
  `src/hvac_agent/core/`, `src/hvac_agent/simulation/`, `src/hvac_agent/integrations/`,
  `configs/site/` and `tests/`. Do not add dashboard, API, agent, prediction, pilot,
  knowledge or training features under it; later stages need their own authorization.
  Those two stages are delivered and were merged to `main` through PR #2 on 2026-10-10
  — see [docs/simulation.md](docs/simulation.md) — and that authorization does not
  extend to anything beyond them.
- On 2026-10-01 the owner requested folder-local UI and cooling-load prediction
  implementation briefs for junior engineers. This handoff change is documentation
  and folder setup only. When assigned implementation, follow
  `apps/dashboard/README.md`, the relevant feature README, and
  `src/hvac_agent/prediction/README.md`; coordinate API shapes through
  `docs/ui-data-contracts.md`. Draft components/endpoints are not existing code.
  Keep UI fixtures explicitly labeled and preserve the single-DGX/site constraints.
- On 2026-10-11 the owner authorizes the backend of stage 5 of that sequence,
  cooling-load prediction, developed on the `feat/prediction` branch. Work under it is
  confined to `src/hvac_agent/prediction/`, `tests/` and prediction documentation; add
  a type to `core/` only when another module genuinely needs that contract. It does
  not authorize changes to `simulation/`, the agent, pilot, knowledge or training
  modules, the API routes or the dashboard, nor choosing the API or dashboard
  frameworks. Stages 3 and 4 remain unauthorized: prediction reads data through
  injected interfaces and must not depend on them.
- Implementation happens on a branch and lands through a PR, never directly on `main`.
  A PR must pass `pytest` and be validated on the DGX Spark; state explicitly when DGX
  validation could not be completed.
- Backend modules live under `src/hvac_agent/`; entry points under `apps/` compose
  them. See the architecture document for dependency direction and ownership.
- `core` owns shared domain contracts, not provider clients or application logic.
- Keep provider-specific integrations behind adapters. Apart from the selected
  modified PHYVAC foundation, do not choose frameworks, databases, model families,
  or other dependencies just to populate empty folders.
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

After substantive work, update [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) in the same
handoff, following its context-maintenance protocol. Record actual branch/commit/PR
status, decisions, completed and remaining work, and validation evidence. Distinguish
planned, implemented, reviewed, merged, deployed, and validated states. If you cannot
edit it, provide a proposed patch and state that it has not been saved. The context
prompt is informational and does not authorize starting its roadmap.

Keep this file, both product descriptions, module READMEs, and the architecture
document consistent when the owner changes product scope. This file is durable
project context; session-only credentials are deliberately not durable memory.
