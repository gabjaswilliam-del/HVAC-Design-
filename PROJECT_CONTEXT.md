# HVAC Agent — living project context prompt

**Last updated:** 2026-10-28 (Asia/Shanghai)

**Purpose:** A self-contained information prompt for an LLM joining this project.

**Repository:** [yxiao986/hvac-agent](https://github.com/yxiao986/hvac-agent)

Give this entire document to another LLM as its project context. The text below is
the prompt; a separate implementation request is not included.

## 1. Your role and how to use this context

You are collaborating on `hvac-agent`, a standalone data-center maintenance and
operations product. Understand its goals, constraints, architecture, evidence, and
unfinished work before responding to the owner's current request.

This document supplies context. It does **not** instruct you to build the product,
start the roadmap, fix every listed issue, deploy anything, or merge a PR. Work only
within the owner's actual request and applicable repository instructions. A proposed
feature, a roadmap entry, and authorization to implement it are different things.

Treat this as a living handoff, not a permanent assertion about repository state.
At the start of repository work, identify the checkout, branch, commit, working-tree
changes, and relevant PR head. Check whether the status snapshot below is still
current. If you cannot verify something, label it as last known or unverified.
Preserve the owner's work and do not switch or overwrite a checkout blindly.

Read `AGENTS.md` and the task-relevant source documents. The owner's latest explicit
decisions determine intended scope; source code, commits, tests, and review evidence
determine what exists and what has been verified. If documentation disagrees with
them, make the discrepancy explicit instead of silently treating a plan as shipped.
This prompt does not override higher-priority instructions in your environment.

You must maintain this document as described in section 15 after substantive work.
Do not invent progress, permissions, deployment status, or validation results.

## 2. What we are building

The product is an agent system/harness for maintaining and operating a **data
center**, including its HVAC and cooling plant. It combines a monitoring dashboard,
an interactive agent, a site-configured simulator, cooling forecasts, a simulation
AI pilot, and a curated engineering knowledge base.

The intended operator experience is one coherent application. Its primary monitoring
screen is an animated 2D view of the installed site's equipment, derived from CAD.
An operator can ask questions, inspect evidence and telemetry, investigate a device,
run a simulation, inspect forecasts, and follow the pilot's actions and outcomes.

The long-term goal is a repeatable, installable product that represents the actual
site. A generated schematic, plausible animation, working demo, or passing software
test is not proof of a faithful model of a real pump station.

## 3. Fixed product decisions

- **One DGX Spark, one data center, one installation.** No multi-site registry,
  tenant hierarchy, fleet dashboard, or cloud control plane. Many rooms, loops,
  chillers, pumps, sensors, operators, conversations, and simulation runs can belong
  to the same installation; that does not make it a multi-site product.
- **All product compute and storage are local to that NVIDIA DGX Spark.** This
  includes dashboard/API hosting, the harness, LLM/image/embedding inference, CAD
  processing and asset generation, RAG, agent memory, databases, modified PHYVAC,
  forecasts, the pilot, site adaptation, and planned model training jobs.
- **Installed operation has no required internet or second compute host.** Site
  equipment and operator browsers may connect over the LAN. Artifact downloads can
  be explicit provisioning/update steps; locally staged artifacts must be possible.
  Do not introduce a required cloud API, remote database, or developer laptop.
- **Modified PHYVAC is the selected simulation foundation.** It is not an open
  engine-selection question. Keep engine-specific behavior behind an adapter.
- **Simulation is a product capability**, available on demand to operators, as well
  as a development/evaluation tool. It is not merely a replay demonstration.
- **The pilot's corrections target simulations.** Physical equipment actuation is
  a separate, undefined design scope. Simulation control is not permission to
  write to real HVAC equipment.
- **Installation and lifecycle management are part of the deliverable.** Plan
  commissioning, managed startup/restart, upgrades, rollback/recovery, and
  backup/restore. A collection of manually started services is not the final product.
- **Forecast adaptation and backbone LLM training are distinct.** Do not describe
  either as already complete or equate LLM alignment with an HVAC controller policy.

These decisions persist unless the owner explicitly changes them. Frameworks,
databases, model families, and service boundaries are not implied by empty folders.

## 4. Intended capabilities

### CAD Studio and commissioning

Accept a customer's CAD file and analyze equipment, layers, ports, and connections.
Produce an editable semantic site definition and a separate 2D scene/design file.
Integrate local image models to generate equipment sprites and animation assets
during installation. Use the animated scene as the dashboard's first monitoring view.

CAD geometry alone cannot establish all physical parameters. Commissioning must
collect equipment specifications, performance curves, operating limits, sensor
mappings, and operator-confirmed connectivity. Preserve evidence and unresolved
unknowns instead of filling them with an undocumented conventional plant pattern.

Stable equipment IDs must connect the scene, telemetry, simulator, forecasts, and
agent tools. Scene layout and generated artwork are presentation: moving a sprite
must not change physics. Physical topology or parameter changes require a new site
revision and validation of dependent artifacts.

### Dashboard and local API

Provide the animated monitoring screen, device details, charts, conversations,
forecast views, simulation controls/results, and pilot issue/action history. The
agent should be able to present grounded data views and highlight equipment within
the same workspace. Keep presentation requests separate from simulation commands.

The API composes backend modules and application lifecycle. No production API
transport has been selected. A Version A dashboard prototype (React 19, TypeScript and
Vite, approved on 2026-10-04 for that prototype) and a framework-neutral local WSGI
server for knowledge and memory (`apps/api/local_server.py`) are merged into the local
`main`; see section 6 for push and validation status. The prototype shows labelled demo
data everywhere except its knowledge workspace.

### Interactive agent harness

Support site questions, streamed tool use, investigation, task/session state,
cancellation, memory, and visible partial/error results. OpenClaw, Codex, and Claude
Code are interaction references, not selected dependencies. Tools should access
telemetry, domain knowledge, forecasts, and simulation through module interfaces.
Do not embed a simulator or retrieval implementation directly in the harness.

### Generalized, site-configured simulation

Assemble each installed site's model from its validated topology and equipment
parameters, using modified PHYVAC. Avoid handwritten implementations per station.
Here, generalized means reusable, configuration-driven assembly within explicitly
supported topology families; it does not mean that arbitrary HVAC graphs are already
supported. Unsupported connections or equipment must be reported or rejected.

Provide explicit start/reset, step, play, pause, stop, observation, action, and result
history semantics. Reading a state must not advance simulation time. The simulation
clock must be independent of browser refreshes and LLM latency. Retain repeatable
initial conditions and matched baseline-versus-pilot scenarios.

Distinguish cooling demand, heat absorbed, heat removed, unmet demand, loop heat
accumulation, electrical power, energy, and efficiency. Check both flow and pressure
relations, per-device heat balances, units, and operating limits. Report uncertainty
and model limitations. Comparing against another simulator is useful for finding
bugs; measured site data is needed to establish site fidelity.

### Cooling prediction

A separate model predicts future cooling demand/behavior. During installation,
train or adapt it using usable historical site data. Without that data, use our
pretrained model conditioned on site configuration. This pretrained fallback is an
intended capability, not an existing model artifact.

Define targets, horizons, chronological evaluation, baseline comparisons, uncertainty,
and no-history behavior. Predicting COP from current readings is not automatically
a future cooling forecast. Model family and accuracy targets remain undecided.

The 2026-10-01 engineering handoff defines the first UI target as site-wide required
cooling load in thermal kW (`cooling_load_kw`). A full prediction page and a compact
summary beneath the monitoring scene consume the same result. These are implementation
briefs, not an implemented predictor or a choice of model family/horizon.

### HVAC-informed AI pilot

Monitor in real time while simulations run. Screen for anomalies, investigate with
HVAC knowledge and evidence, propose corrections, apply validated simulation actions,
and measure outcomes. Track persistent issues through detection, investigation,
correction, and resolution instead of creating a new unrelated alert every tick.

Slow inference must not block stepping. Actions must target the correct run and
equipment and be checked for freshness, limits, and supported semantics. Preserve
the distinction between proposed, queued, applied, and achieved actions, including
rejections, replacements, and expiry. Do not assume a stored setpoint proves an
achieved physical result, even within a simulation.

### Curated knowledge and domain-specialized LLM

We build the RAG knowledge base from curated HVAC/data-center engineering material
and site documentation. Preserve citations, provenance, and versioning. Retrieval
knowledge, conversation memory, telemetry history, and training datasets are
separate responsibilities and must not become one undifferentiated store.

The planned backbone LLM specialization path is domain fine-tuning, RLHF, and later
RLAIF, with evaluations and traceable feedback/model artifacts. No specialized LLM,
training pipeline, or measured specialization claim is complete. Choose workloads
that fit the DGX's measured memory/compute budget; training and image generation
must be scheduled alongside, not assumed to fit freely within, continuous operation.

## 5. Repository organization and dependency direction

| Location | Responsibility |
|---|---|
| `apps/dashboard/` | Monitoring scene, chat, forecasts, simulation and pilot UI |
| `apps/api/` | Local API, lifecycle, and application composition |
| `src/hvac_agent/core/` | Shared identities, topology, units, metrics, actions, observations |
| `src/hvac_agent/cad/` | CAD interpretation, semantic extraction, scene/asset workflow |
| `src/hvac_agent/agent/` | Harness, tools, conversations, sessions, agent memory |
| `src/hvac_agent/simulation/` | Scenarios, run clock/lifecycle, baseline/dispatch, corrections/history |
| `src/hvac_agent/prediction/` | Forecast inference, data preparation, site adaptation |
| `src/hvac_agent/pilot/` | Monitoring, diagnosis, issue lifecycle, simulation correction policy |
| `src/hvac_agent/knowledge/` | Curated ingestion, retrieval, RAG provenance |
| `src/hvac_agent/training/` | Backbone fine-tuning, RLHF/RLAIF, evaluations and feedback |
| `src/hvac_agent/integrations/` | PHYVAC, telemetry/BMS, model-serving and storage adapters |
| `configs/site/` | Sanitized configuration examples for one installation |
| `deployment/dgx-spark/` | Installation, commissioning, packaging and lifecycle guidance |
| `scripts/` | Thin operational/validation utilities |
| `tests/` | Unit, integration, characterization and future evaluation checks |
| `docs/` | Architecture, reference findings and design documentation |
| `var/` (ignored) | Real site configuration, models, telemetry and generated runtime artifacts |
| `.local/` (ignored) | Private workstation notes, connection details and review scratch artifacts |

Modules do not have to be microservices. The deployment unit is one local product.
`core` is the lowest layer and must not import feature modules or provider clients.
Features use shared contracts and public interfaces; adapters implement module-owned
interfaces; applications wire them together. The pilot and agent request simulation
operations instead of mutating PHYVAC internals. Training jobs produce artifacts;
runtime modules should not require training machinery simply to operate.

Shared artifacts should retain site/configuration revision, equipment identity,
units, timestamps, observation origin/quality, and simulation-run identity where
applicable. Real telemetry and simulated observations must remain distinguishable.

## 6. Verified project state as of 2026-10-28

Fetched `origin` on 2026-10-28: remote `main` was `efc0a0a`, the 2026-10-23 sync record.
The fork's 2026-10-27 Memory Graph work was then integrated (see "Fork update:
2026-10-27" below) and, at the user's instruction ("push"), `main` was pushed to `origin`
as a fast-forward with this context update, without a pull request. The fork's `main`
then received one commit on top of `6e8217a`, without force, whose files are identical
to this `main` at the commit that records the push.

On 2026-10-23, at the user's request, the collaborators' fork
[gabjaswilliam-del/HVAC-Design-](https://github.com/gabjaswilliam-del/HVAC-Design-) was
brought level with this repository: one commit by the user on top of the fork's `2c87b8a`
whose files are identical to this `main` as of this update. It was pushed without
force, so the fork keeps its own history, including its original commits; the two
histories differ while the files match. That commit removes from the fork the files this
repository never carried (`.claude/`, `CLAUDE.md`, `install.ps1` and the root
`package.json` and `package-lock.json`); they remain in the fork's history.

Fetched `origin` on 2026-10-19: remote `main` was `ae9c139`, the 2026-10-16 push below.
The fork's 2026-10-17 commits were then integrated (see "Fork update" below) and, at the
user's instruction ("push to main"), `main` was pushed to `origin` as a fast-forward with
this context update, without a pull request.

Fetched `origin` on 2026-10-16: remote `main` was still at
`6b9fa285ad8675b4141b193b0d954ade0bba8098`. At the user's instruction ("push to main"),
the local `main` (the 2026-10-14 dashboard merge and its context update) was fast-forwarded
to `feat/prediction-vs-actual`, this context update was committed on top, and `main` was
pushed to `origin` as a fast-forward, without a pull request. Prediction-branch
implementation was not re-reviewed.

| Item | Verified state |
|---|---|
| PR #1 — modular scaffold | [Merged](https://github.com/yxiao986/hvac-agent/pull/1) on 2026-09-20 |
| PR #2 — simulation foundation | [Approved](https://github.com/yxiao986/hvac-agent/pull/2#pullrequestreview-5477334444) at `ac0697e` and merged on 2026-10-10 |
| `main` (local and remote) | Pushed 2026-10-28, fast-forward from `efc0a0a`: the fork's Memory Graph `20b0166`, the integration record `7c585b7` and this context update. Pushed 2026-10-19, fast-forward from `ae9c139`: the fork's RAG Graph `fd80e7e` and CAD Studio `20070f6`, the integration record `9d1c9fd` and this context update. Pushed 2026-10-16, fast-forward from `6b9fa28`: the dashboard merge `404ee4d`, its context update `48a8baa`, the owner UI changes `a8b610a` and `ae9c139`. No PR for any of them, at the user's instruction; `pytest` and the dashboard unit tests and build pass on the user's macOS workstation; browser tests not run; not DGX-validated |
| Fork `gabjaswilliam-del/HVAC-Design-` | `main` synced 2026-10-23 (one commit on top of `2c87b8a`, no force-push). Now `6e8217a` (2026-10-27): gabjaswilliam-del's Memory Graph commit `14310a4`, built on the fork's pre-sync history, merged with the sync commit. On 2026-10-28 one more commit on top of `6e8217a` (no force-push) made its files equal this `main` at the commit that records the push; history still differs |
| `feat/fork-update-2026-10-27` | Local branch from `efc0a0a`: `14310a4` replayed as `20b0166` (author kept) and the integration record; local `main` fast-forwarded to it and pushed on 2026-10-28. The branch itself was not pushed; no PR, browser tests not run, not DGX-validated |
| `feat/prediction` | Upstream records creation from `e7b29be` on 2026-10-11; branch implementation was not rechecked during this pull, and no prediction code is merged on main |
| `feat/prediction-vs-actual` | Local branch from `48a8baa` with the owner UI changes `a8b610a` (below); now contained in `main`. The branch itself was not pushed |
| `feat/fork-update-2026-10-17` | Local branch from `ae9c139`: the fork's two 2026-10-17 commits replayed with their authors, and this context update; local `main` fast-forwarded to it and pushed on 2026-10-19. The branch itself was not pushed; no PR, browser tests not run, not DGX-validated |
| Integrated standalone application | Not implemented or released |
| Customer/site commissioning and physical validation | Not completed |

Merged and approved does not mean calibrated against a site or ready for customer
deployment; see section 7 for the model's limits.

Initial work authorized folder structure and documentation. `AGENTS.md` records later
authorization for stages 1 and 2: site contracts and the simulation foundation,
confined to core/simulation/integrations, configuration, tests, and associated
documentation. Both are merged. On 2026-10-11 the owner authorized the **backend** of
stage 5, cooling-load prediction, on `feat/prediction`, confined to
`src/hvac_agent/prediction/`, `tests/` and prediction documentation. It excludes the
API routes, the dashboard and their framework choices; stages 3 and 4 remain
unauthorized. Other product stages require their own task authorization. Creating or
reading this context prompt does not extend that scope.

This scope and status update was committed directly to `main` without a PR, at the
owner's explicit instruction, as on 2026-10-04. It is documentation only.

On 2026-10-01 the owner requested folder-local UI and cooling-load prediction
instructions for junior engineers. That task added README briefs and a draft data/API
contract, not feature code. Engineers assigned these modules should start at the
dashboard/prediction handoffs below. Draft endpoint names are not existing services.

| Capability | What exists | What remains |
|---|---|---|
| Modular layout and product definition | Merged scaffold, ownership READMEs, product descriptions in English/Chinese, architecture and installation requirements | Keep synchronized with verified implementation and owner decisions |
| Site contracts and metrics | Merged on `main` through PR #2 after three request-changes reviews and a fourth approving review | Consistency with future scene, telemetry and model bindings |
| Modified PHYVAC and simulation lifecycle | Merged on `main` through PR #2 with tests; every review finding verified resolved | Measured-site fidelity, calibration workflow, topology coverage beyond the current family |
| CAD Studio, generated assets, editable scene | UI folder brief and backend responsibility documented; on `main` (pushed 2026-10-19 without a PR) a fixture-only `/cad` review interface from the fork (tcy, 2026-10-17): file-selection placeholder that stops at "Parser not connected", one synthetic sample, synchronized side-by-side drawing and extraction canvases, findings and evidence review, fixture port resolution, and a labelled draft preview in the Overview renderer. No parser, backend, model, persistence or activation | Real CAD formats/parser, durable jobs, backend validation, generated assets and commissioning integration |
| Dashboard/API and telemetry ingestion | Per-screen/shared UI briefs, ownership folders and draft API/data contracts; on `main` (pushed without a PR on 2026-10-16, 2026-10-19 and 2026-10-28), the Version A prototype (milestones M0 to M7.6) on labelled fixtures and a local WSGI server for knowledge and memory; and the 2026-10-15 owner UI changes (section 6) | Browser-test run; owner confirmation of scope; DGX build/test validation; live simulation and telemetry adapters; production API transport; replacing fixtures |
| Harness, local model serving, RAG and memory | On `main` (pushed 2026-10-16 without a PR): a scripted assistant demonstration with no language model, and a knowledge (graph RAG) and memory service using the Python standard library and SQLite, with 62 tests | Model serving, a real agent loop and tools, curated content, model selection/evaluation |
| Cooling prediction and installation adaptation | Backend subfolder briefs, API route brief, full-page/monitoring UI brief; backend authorized on `feat/prediction`, no code merged on main | Models/data pipeline, no-history path, backtesting and uncertainty; API/UI integration awaits stage 4 |
| Simulation AI pilot | Responsibility/plan only; supporting action/run contracts merged with the simulation foundation | Monitoring/diagnosis policy, issue workflow, tool integration and evaluation |
| Domain LLM training | Objective only | Data/feedback pipelines, evaluations, fine-tuning, RLHF and later RLAIF |
| Standalone installer and managed lifecycle | Requirements documented | Packaging, service management, commissioning, upgrade and recovery implementation |

### UI and prediction handoff locations (documentation only)

- `apps/dashboard/README.md` indexes all assignments and common UI acceptance.
- `apps/dashboard/src/app/` owns shell/context; `components/` and `styles/` own
  shared UI patterns; `lib/api/` and `lib/contracts/` own client/boundary schemas;
  `fixtures/` owns clearly labeled synthetic development scenarios.
- `apps/dashboard/src/features/` contains briefs for monitoring, equipment,
  cad-studio, agent, simulation, prediction, pilot, knowledge, installation and system.
- `features/prediction/` owns `PredictionPage`, `CoolingForecastSummary` imported
  by monitoring, and setup readiness UI. Component names are proposed, not code.
- `src/hvac_agent/prediction/` has preparation, inference, adaptation and evaluation briefs.
  `apps/api/routes/prediction/README.md` specifies the proposed UI transport.
- `docs/ui-data-contracts.md` defines draft target/units/source/run/cutoff semantics,
  forecast/job states, provenance, error handling and end-to-end acceptance.

The frontend framework, exact visual tokens, API framework and prediction model
remain undecided. UI fixture demonstrations must not claim live integration, model
accuracy, successful installation or physical equipment control.

### Dashboard merge from a collaborator's fork (2026-10-14)

At the user's request, merge commit `404ee4d` (branch `feat/dashboard-ui`) merges
[gabjaswilliam-del/HVAC-Design-](https://github.com/gabjaswilliam-del/HVAC-Design-),
a fork of this repository from `main` at `85093f8` (PR #1) with seven commits by
gabjaswilliam-del dated 2026-10-04 to 2026-10-10. The user then asked for it to be merged
into `main`, and the local `main` was fast-forwarded to it without a pull request; this
departs, at the user's direction, from the `AGENTS.md` rule that work lands through a PR
that passes `pytest` and DGX validation.

- Before merging, those seven commits were rewritten locally (original head `cd94b78`,
  cleaned head `48c4dc2`; authorship and dates unchanged). Co-author trailers naming an AI
  coding assistant were removed from the messages at the user's request. Files that were
  specific to the fork author's workstation or tooling were removed from that history:
  `.claude/` (hooks pointing at another workstation's paths and a third-party skill),
  `CLAUDE.md`, `install.ps1` (a tool installer) and a stray root `package.json` and
  `package-lock.json` (the dependency is already declared in `apps/dashboard/package.json`).
- The merge adds `apps/dashboard/` (the Version A prototype, its tests, and the records
  `VERSION_A.md`, `DESIGN.md` and `M6_HANDOFF.md`), `apps/api/local_server.py`, the
  knowledge and memory modules (`src/hvac_agent/knowledge/`, `agent/memory.py`,
  `integrations/{embeddings,knowledge_store,memory_store,pdf_text}.py`, `core/errors.py`),
  `scripts/export_knowledge_demo.py`, three test modules and a `.gitignore` entry.
- Twelve documentation files conflicted. `main`'s newer text was kept for `AGENTS.md`,
  `docs/ui-data-contracts.md` (with `requested_mode`), the simulation READMEs and this
  file; the fork carried an older copy of the 2026-10-01 handoff and a 2026-10-04 snapshot
  of this file. The fork's implemented-status lines were taken for the agent, equipment,
  monitoring and prediction feature READMEs, and the status sentences in
  `apps/dashboard/README.md` and both product descriptions were updated.
- Scope: `AGENTS.md` records authorization for stages 1 and 2 and for the stage 5
  prediction backend. Dashboard, API, agent and knowledge work belongs to stage 4, which
  `AGENTS.md` still lists as unauthorized. The owner should confirm this scope and
  record the authorization in `AGENTS.md`; that has not been done.
- The fork's own records predate this merge: `VERSION_A.md` lists M7 and M7.1 as
  uncommitted and awaiting review, and `M6_HANDOFF.md` refers to the removed local files
  and the fork author's workstation. They were left unchanged as history.

### Fork update: 2026-10-27 (integrated 2026-10-28)

At the user's request, the fork's commits after the 2026-10-23 sync commit `069aaae` were
read: `14310a4` (gabjaswilliam-del, 2026-10-27, "Complete Memory Graph 3D redesign and
icon fixes"), whose parent is the fork's pre-sync `d960455`, and `6e8217a`, a merge of it
with `069aaae`. No AI co-author trailer is present.

- **No conflict with this repository.** The merge's net change since `069aaae` touches the
  same 27 files as `14310a4` with identical per-file patches (`git patch-id`), so it
  reverts nothing here, and none of the files removed by the sync came back. Replayed
  onto `efc0a0a` as `20b0166` in a temporary clone, without conflicts; the result's tree
  equals the fork's `6e8217a`.
- **What it adds:** Version A M7.4 to M7.6, Graph Memory as a full-page timeline and a 3D
  constellation, the memory graph's name and its 3D icons, all in
  `features/knowledge/` plus `lib/i18n/knowledge.ts`, a Knowledge URL parameter (`mlink`)
  in `app/navigation.ts`, and the fork's records (`DESIGN.md`, `VERSION_A.md`,
  `M6_HANDOFF.md`). No dependency, Python, simulation, prediction, Overview or deck
  change; it adds no global keyboard handler.
- **Validation** on the user's macOS workstation: `tsc --noEmit` clean, Vitest 215 passed
  in 23 files, `vite build` succeeded. No Python changed, so `pytest` was not rerun.
  Browser tests not run; not DGX-validated.
- The dashboard README's milestone range now reads 0 to 7.6; the fork's `VERSION_A.md`
  rows are kept as written (they still call M7.2 uncommitted).

### Fork update: the collaborators' 2026-10-17 commits (integrated 2026-10-19)

At the user's request ("if those updates do not conflict with my updates … then update
this repository"), the fork [gabjaswilliam-del/HVAC-Design-](https://github.com/gabjaswilliam-del/HVAC-Design-)
was re-read. It has two commits after its `cd94b78` (merged on 2026-10-14 as the cleaned
`48c4dc2`), both based on the fork's original, uncleaned history. They were replayed onto
`main` at `ae9c139` in a temporary clone, so none of that history or the removed files
re-entered this repository. Authors are kept; no AI co-author trailer was present.

- `fd80e7e` (gabjaswilliam-del; fork `d960455`): Version A M7.2 and M7.3, the RAG Graph
  redesign. Knowledge workspace, graph layout, the 3D graph, the local API server and one
  Python test. Applied cleanly; `DESIGN.md` and `shell.spec.ts` merged automatically.
- `20070f6` (tcy; fork `2c87b8a`): the fixture-only CAD Studio at `/cad` as a fifth dock
  section (it was the Engineering hub's row), a design-preview mode of `PlantViewport`
  that hides telemetry, and an optional developer-only language overlay (`?lang=zh`, from
  an ignored `src/lib/i18n/*.local.ts`; the tracked interface stays English). Three
  overlap conflicts, none against the owner's changes in intent: the shortcuts list line
  (kept "Prediction" and added "CAD Studio"), the dashboard README status (kept this
  repository's current text and added a CAD sentence) and this file (this repository's
  copy kept; the fork's copy was its 2026-10-04 snapshot, and its CAD entry is
  summarized here instead).
- The overlap was otherwise checked: `/cad` no longer opens the Engineering hub; the
  equipment records `/equipment` redirects to are unchanged; the design preview is off on
  the Overview, so "Plant off" and the playback rules are unaffected. A leftover
  "Analytics" dock link in `e2e/attention.spec.ts` (from the 2026-10-15 rename, not the
  fork) and two comments were corrected; the dock description in `DESIGN.md` now names
  five sections.
- The fork's own records still describe this work as uncommitted and awaiting owner
  review (`VERSION_A.md`, the CAD feature README); they were kept as the authors wrote them.
- **Validation** on the user's macOS workstation: `tsc --noEmit` clean, Vitest 198 passed
  in 21 files, `vite build` succeeded, `pytest` 554 passed, 4 xfailed (Python 3.12, a
  temporary virtual environment). The CAD author reports Windows checks and two focused
  Playwright assertions; not reproduced here. Browser tests not run; not DGX-validated.
- **Scope:** CAD Studio belongs to stage 3 and the dashboard and knowledge work to stage
  4, both still unauthorized in `AGENTS.md`.

### Dashboard owner changes on `feat/prediction-vs-actual` (2026-10-15 to 2026-10-16)

At the user's requests, on the fixture prototype only (no model, live API or simulation
service is connected). Each change is noted in the affected feature README.

- **Prediction page and tab.** The dock tab "Analytics" is now "Prediction". `/prediction`
  opens as an empty chart with a horizon and **Predict**; the predicted curve draws in, and
  while the plant plays the actual cooling load is drawn on the same chart up to the
  clock, with the points logged, MAE and MAPE so far (`predictionError.ts`). The
  prediction persists for the tab session (`predictionStore.ts`).
- **Deck and plant.** The Overview plant runs only while the deck plays ("Plant off"
  otherwise). The deck opens on the live demo, paused, at 60×, with **Run simulation**
  (**Play replay** in the replay); the speed applies to both sources.
- **Simulation and replay are mutually exclusive** (`app/operatingContext.ts`): the other
  source cannot be chosen while one plays; an AI Pilot run, which keeps its own clock,
  keeps the replay waiting until it is paused; starting AI Pilot runs the simulation but
  is refused while a replay plays; running the simulation never starts AI Pilot. To know
  about AI Pilot runs, the deck keeps the simulation session's run list polled (every
  0.5 s) instead of only while the AI Pilot panel is open. The two clocks are not unified.
- **AI display** (`features/display/`) replaces the Overview's equipment list
  (`EquipmentList.tsx` removed; `/equipment` redirects to Engineering). The assistant
  shows line, bar, table, stats, inline PNG/JPEG/WebP images and model-written HTML (in a
  sandboxed iframe with a network-blocking CSP) through one tool, `show_on_display`,
  whose MCP definition is generated from its zod schema (`lib/contracts/display.ts`). A
  new `display` assistant event carries it; the scripted demo assistant now uses it.
  No MCP server or model harness exists; `src/hvac_agent/agent/README.md` notes the tool.
- **Validation** on the user's macOS workstation: `tsc --noEmit` clean, Vitest 192 passed
  in 19 files, `vite build` succeeded; `pytest` 553 passed, 4 xfailed (Python 3.12, a
  temporary virtual environment, before the push). Playwright specs were written or
  updated but **not run** (the browser is not installed). No Python code changed. Not
  validated on the DGX.
- **Scope:** this is further stage 4 dashboard work, which `AGENTS.md` still lists as
  unauthorized; the owner should confirm it with the earlier dashboard merge.

## 7. What the merged simulation foundation implements

Merged on `main` through PR #2. Read `docs/simulation.md`, configuration guidance,
code, and tests before changing this foundation.

- Core unit conversions, a `device:metric` vocabulary, observations with origin,
  quality, notes and revisions, partial actions, and a site-definition loader.
- A site manifest `configs/site/site.yaml` plus six content files:
  `topology.yaml`, `equipment.yaml`, `control.yaml`, `boundary.yaml`,
  `calibration/physics.yaml`, and `calibration/display.yaml`. Topology carries
  evidence; calibration overlays carry provenance. Real installation files belong
  outside Git, typically under `var/site/`.
- A vendored modified PHYVAC engine, import shim, plant builder, hydraulic solver,
  and coupled step behind `integrations/phyvac/`.
- Baseline staging/control, topology-aware dispatch, run-owned clocks, scenario
  stepping and history, and a correction gate/ledger in `simulation/`.
- Manual overrides held until replaced or released; a PLC action releases all
  overrides. Running-state commands affect availability and dispatch. These are
  simulation semantics, not a physical equipment control design.
- Distinct reported demand/removed cooling/unmet cooling/loop heat accumulation,
  engine quality notes, and operating-envelope failure reporting.
- Per-machine temperature points from the engine's own calculation for that step;
  mixed loop temperatures only on SYSTEM points; a machine with no water moving
  through it reports the header water, marked uncertain with a note.
- A chiller cools only with water on both sides; one told to run without it removes
  nothing, and the shortfall is unmet demand. The operating envelope covers each
  cooling chiller's own outlets as well as the mixed loops.
- Parallel pumps at unequal speeds resolved into a shut check valve or the rising
  part of the slower pump's curve, with every conducting branch on its own curve.
- Header pumps staged as a shared pool rather than one per chiller.
- Actions copy their setpoints into an immutable snapshot when made, so the checked,
  executed and recorded values cannot diverge.
- Synthetic configuration/workbook fixtures, component characterization, integration
  and lifecycle tests, and comparisons with a reference simulator.

Current topology family: `water_cooled_chiller_plant_v1`. It models water-cooled
electric chillers, open cooling towers, primary chilled/condenser-water pumps,
headers, one lumped terminal, and associated bypass/isolation arrangements. It is
not a general arbitrary-network solver. Secondary loops, thermal storage, chillers
in series, heat recovery, free cooling, grouped machine coupling, and individual
air handlers are outside its current declared coverage.

The model has explicit time lags and no resolved loop thermal mass. Cold-start
overshoots and operating-envelope limits are documented approximations. It is
**not validated against site measurements**. Nameplate configuration and fitted
site calibration must stay distinguishable; fitting can absorb existing degradation,
so an uncalibrated baseline can remain useful for fault comparisons. The amount and
quality of telemetry needed for calibration must be measured, not promised universally.

### Engine provenance and dependencies

The foundation vendors a `simulate_ai` fork of upstream
[ShoheiMiyata/phyvac](https://github.com/ShoheiMiyata/phyvac), using baseline commit
`5b452aa23474216a76d1e57b1d104cef123e1c04`, engine string `ver20231120`.
The exact upstream commit is unknown. Its provenance, source location, license
notice, and reproducible patches are recorded in
`src/hvac_agent/integrations/phyvac/vendor/UPSTREAM.md`.

A NumPy 2 compatibility patch uses `.item()` for scalar extraction. Four strict
expected-failure checks pin defects in storage/absorption components outside the
current topology family. Do not enable those components without resolving the
defects and validating affected results. Vendor changes should have recorded patches,
reasons, tests, and DGX characterization; do not silently edit vendored arithmetic.

The upstream BSD-3-Clause notice is included. The provenance file records unresolved
permission to redistribute the fork authors' modifications; resolve and document that
before customer distribution. Do not infer that the copied upstream notice resolves every
fork-specific right or claim permission has already been obtained.

The backend requires Python 3.11+. It declares NumPy, pandas, SciPy, openpyxl,
matplotlib, scikit-learn, and PyYAML, plus pytest for development. Some libraries
are inherited from engine imports, not product technology selections; their presence
does not choose a prediction model family. Inspect the branch's `pyproject.toml`;
do not claim release dependency locking has been solved.

## 8. Review status, evidence, and immediate unfinished work

PR #2 received three request-changes reviews, followed by an approval at `ac0697e`
on 2026-10-10. The earlier findings are now verified resolved. These are engineering
checks with synthetic reproductions, not measurements of the real data center.

### First review: fixes present at the latest reviewed head

At `d625107959a6563924ba5d88810d606db1680626`, the review found ignored topology
links, cooling metrics reconstructed from demand, incorrect per-device command
routing/ignored stop commands, baseline values masquerading as frequency feedback,
incorrect action application history, and display settings affecting physics.

The updated head `3d5663d` addresses those six reproductions with corresponding
regression coverage. Keep that coverage. The first review is
[recorded here](https://github.com/yxiao986/hvac-agent/pull/2#pullrequestreview-5363041134).

### Second review: all four findings verified resolved at `b0d90c9`

The [follow-up review](https://github.com/yxiao986/hvac-agent/pull/2#pullrequestreview-5368901805)
identified four findings at `3d5663d`. The third review independently verified the
candidate fixes and their original synthetic reproductions on the DGX:

| Previous finding | Fixing commit | Verified behavior at `b0d90c9` |
|---|---|---|
| P1: unequal-speed pump flow did not satisfy its pressure equation | `9fcd6a2` | Original rising-curve case satisfies each branch head; the 45 Hz chilled-pump correction closes the slower pump's check valve. Additional sweep: 240 three-/four-pump cases satisfy branch-pressure and mass-balance checks. |
| P2: common-header pumps incorrectly assigned exclusively per chiller | `e32d2dc` | Two chillers on one pump per side both run; the original synthetic 1,000 kW scenario reports about 1,314 kW removed after four steps, exceeding one chiller's rating. This transient removal is not a measured capacity claim. |
| P2: each chiller reported mixed/next-step water temperatures | `62055f0` | Original 9.5 °C correction reports separate outlets 9.5 °C and 8.41526 °C and completed-step inlets 14.76512 °C. Regression coverage includes condenser and tower temperatures and no-flow behavior. |
| P2: caller mutation bypassed limits and rewrote the action ledger | `2f7b479` | Changing the caller's dictionary from 9.5 to 20 °C after acceptance leaves both the applied setpoint and recorded proposal at 9.5 °C. |

Keep the corresponding regression coverage. Resolution of these four findings does
not establish correct behavior for all combinations of the newly supported states.

### Third review: P1 finding verified resolved at `ac0697e`

The [third review](https://github.com/yxiao986/hvac-agent/pull/2#pullrequestreview-5411611269)
requests changes for `integrations/phyvac/plant.py`, around lines 290–323:

- **Chiller continues cooling with zero condenser-water flow.** On the synthetic
  example site, run eight steps at 1,000 kW, then submit condenser pump 1 at 50 Hz
  and pump 2 at 30 Hz through the correction gate and take one step. Both commands
  are valid. The solver returns condenser source flows `(3.9773560201, 0, 0)` m³/min,
  but chiller 2 still reports 513.243028 kW of cooling. The chiller calculation is
  passed an invented `g_cd = 1e-6`; its condenser outlet is 8,459,753.606803 °C and
  marked `good`. The step succeeds because that stream has zero mixing weight.
  Only the pump has an uncertainty note; no real condenser heat path exists.
- **Required behavior:** require actual positive water flow on both sides before
  calculating active cooling, or reject the unsupported step explicitly. An inactive
  chiller must preserve/pass through water on whichever side still flows, report
  unavailable flow/temperatures honestly, and account for lost cooling in the system
  heat balance. Add integration coverage for the 50/30 Hz correction, including
  cooling, temperature quality and unmet demand. The existing unequal-speed plant
  regression covers loss of evaporator flow only.

The new shut-check-valve solver makes this state reachable within accepted equipment
limits. Fix `1b3e1c3`, documented in `ac0697e`, guards actual flow on both sides,
removes the invented condenser-flow clamp, reports starvation and pass-through
water honestly, and checks each calculating chiller's outlets against the envelope.
The two integration regressions cover zero condenser flow and a positive trickle.

### Fourth review: approved at `ac0697e`, no remaining review blocker

The [fourth review](https://github.com/yxiao986/hvac-agent/pull/2#pullrequestreview-5477334444)
independently verified the third-review fix on the designated DGX Spark:

- Original eight-step, 1,000 kW, 50/30 Hz reproduction: the starved chiller has zero
  cooling and power; no chiller calculation is called with fabricated flow. Its
  condenser outlet reports 27.460535 °C header water as uncertain, remaining
  evaporator water passes through unchanged, and unmet demand is 486.756972 kW.
- Loss of evaporator flow, condenser flow and both sides all suppress cooling and
  preserve the per-device heat balance. Restoring actual flow resumes engine
  calculation and cooling. The gate accepts valid commands; the observations show
  which outcomes were achieved and which could not be.
- Nearby 50/32 Hz case: the run fails explicitly because the individual condenser
  outlet would reach 66.6 °C, even though the mixed return stays within the envelope.
  The last valid observation/history, successful-step count and simulation time
  remain unchanged after the failure.
- All additional probe assertions passed, including 78 hydraulic balances checked
  against branch pressure-flow curves and mass balance. The complete suite passes
  with all earlier review regression coverage retained.

Approval is for the configuration-driven foundation within its documented topology
family. It is not a claim of measured-site fidelity, calibrated customer operation,
installer/release acceptance, or fixes to the four excluded engine defects. After
approval, the owner authorized merging PR #2 and updating the local main checkout;
both are complete at `e7b29be`. No deployment was performed.

### Verified test results

| Reviewed commit | Environment and result | What it establishes |
|---|---|---|
| `d625107` | Designated DGX Spark, isolated checkout/venv: 388 passed, 4 xfailed | Earlier suite passed despite six targeted correctness findings |
| `3d5663d` | Designated DGX Spark as `ghani`, ARM64, isolated checkout/venv: 463 passed, 4 xfailed; GitHub CI passed at review | Original regressions have coverage; four additional targeted reproductions still fail the intended behavior |
| `e32d2dc` | Author's Windows workstation and designated DGX Spark as `ghani`, Python 3.12.3, isolated checkout/venv: 489 passed, 4 xfailed; run/correction/dispatch tests repeated ten times, 101 passed each | Author-run validation of second-review fixes; separately reproduced by the reviewer at `b0d90c9` |
| `b0d90c9` | Designated DGX Spark as `ghani`, ARM64, Python 3.12.3, fresh temporary checkout/venv: 489 passed, 4 xfailed in 6.82 s; GitHub CI passed | Four second-review reproductions resolved; 240 additional unequal-speed hydraulic cases passed; zero-condenser-flow probe still produces false cooling and impossible good-quality temperature |
| `1b3e1c3` | Author's Windows workstation and designated DGX Spark as `ghani`, Python 3.12.3, isolated checkout/venv: 491 passed, 4 xfailed; run/correction/dispatch tests repeated ten times, 101 passed each | Author-run validation of third-review fix; separately reproduced by the reviewer at `ac0697e` |
| `ac0697e` | Reviewer, designated DGX Spark as `ghani`, ARM64, Python 3.12.3, fresh temporary checkout/venv: 491 passed, 4 xfailed in 6.91 s; GitHub CI passed | Third-review blocker resolved; zero-/trickle-flow, symmetric starvation and recovery probes passed, including 78 hydraulic balances; approval submitted |
| `e7b29be` | GitHub merge and main CI verified; local main fast-forwarded; full-tree comparison with `ac0697e` has no differences | Merge preserves the reviewed/tested implementation exactly; no new DGX test run or deployment was performed during the local update |
| `feat/dashboard-ui` merge of `6b9fa28` and fork head `48c4dc2` | User's macOS workstation (not the DGX), Python 3.14.6, temporary venv, `PYTHONPATH=src pytest`: 553 passed, 4 xfailed in 42 s | The simulation suite is intact after the merge and the fork's 62 knowledge, memory and local API tests pass. DGX validation, CI and the dashboard's `npm` build, unit and browser tests were not run; the fork records its dashboard checks on a Windows workstation only |

The `ac0697e` checks were independently run during the 2026-10-10 review; earlier
rows preserve historical results at their original commits. The author reports
the reference-day comparison unchanged after the second- and third-review fixes;
this is a reference-simulator comparison, not measured-site validation. No full product,
installed deployment, forecasting system, pilot,
specialized LLM, or customer-site fidelity has been validated by those results.

## 9. Reference projects and lessons

`../openclaw-hvac` is a low-quality, inconsistent prototype deployed across separate
machines. Study its workflows, not its implementation as a template. Do not copy
its code, assets, prompts, configuration, credentials, station catalogs, or remote
deployment assumptions, and do not modify that reference repository.

Retain the useful ideas: editable semantic CAD design, shared equipment identity,
agent-driven data views, explicit simulation lifecycle, evidence-backed diagnosis,
persistent issue/outcome history, and measured forecast/controller comparisons.
Its multi-station behavior, remote replay backend, selected models, and benchmark
claims are not requirements or proof for this product.

The simulation work also studied `simulate_ai`, a working PHYVAC integration with
many handwritten site implementations. Its repetition motivates configuration-based
assembly. Its calibration and reference comparison are informative but are not
ground truth; power/energy accuracy cannot be inferred from fitting only temperature,
pressure, and flow. The documented vendored engine is a specific provenance-tracked
dependency, not permission to import the surrounding legacy application.

Detailed source-based findings live in `docs/reference-review.md`.

## 10. Remaining product roadmap

This is a dependency guide and status inventory, not a schedule or instruction to
start implementation. Stages 1 and 2 are merged. The stage 5 backend is authorized
ahead of stages 3 and 4: it proceeds through injected data interfaces, and its API and
dashboard integration waits for stage 4.

| Stage | Remaining outcome |
|---|---|
| 0. Local packaging design | Artifact inventory, resource budgets, preflight, data locations, service/lifecycle ownership and a local deployment path for every dependency |
| 1. Site contracts | Merged; prove consistency across future scene, telemetry, simulator and model bindings |
| 2. Simulation foundation | Merged; define fidelity criteria and measured validation/calibration workflows |
| 3. CAD and installation workflow | Extract/review topology, capture unknown parameters and sensor mappings, generate editable scene and state-aware assets locally |
| 4. Integrated monitoring and harness | Local API/dashboard/telemetry, tools and conversations, local model serving, RAG, memory and grounded data views. A fixture-based UI prototype and a local knowledge/memory service are on `main` (merged 2026-10-14, pushed 2026-10-16 without a PR), pending stage 4 authorization and validation |
| 5. Prediction | Backend authorized on `feat/prediction`, no code merged on main. Pretrained no-history route, historical-data adaptation, chronological backtests, baselines and uncertainty |
| 6. Simulation pilot | Anomaly/issue lifecycle, grounded investigations, validated corrections, measured outcomes and matched controller comparisons |
| 7. Domain LLM specialization | Curated data/feedback, domain evaluations, fine-tuning, RLHF then RLAIF, artifact provenance and DGX resource validation |
| 8. Standalone release acceptance | Complete installer/commissioning/lifecycle, fresh-install/restart/recovery tests and operation without internet or another compute server |

Installation design, evaluation criteria, feedback provenance, and resource planning
should evolve with the modules. The final release stage validates integration; it
does not justify deferring all packaging and installation design until the end.

## 11. Installation and operational acceptance

The intended commissioning sequence is: preflight the DGX; install a versioned
release and locally available model artifacts; initialize storage/configuration;
import CAD and equipment data; review site topology and sensor mappings; generate
scene/assets; configure the simulator from the same revision; ingest knowledge;
adapt prediction if history exists; validate the integrated installation; activate
managed services and hand over operator access.

Release acceptance must cover interrupted/repeated installation, preserved site
data during upgrades, reboot/restart, health reporting and logs, rollback/recovery,
backup/restore, and operation with internet disconnected while LAN access remains.
Separate persistent site state/model artifacts from replaceable software releases.
Keep expensive generation/training jobs from starving monitoring and simulation.
The installer and service manager do not exist yet.

## 12. Open decisions and evidence still needed

- Dashboard framework, API transport, harness framework and tool protocol.
- Local LLM/image/embedding model families, serving runtimes, sizes and scheduling.
- Databases, telemetry history, vector retrieval, memory stores and retention policy.
- Supported CAD formats and engineering review/commissioning UX.
- Telemetry protocols, site equipment access, point mapping and freshness rules.
- Forecast horizons, pretrained artifact, adaptation strategy and accuracy goals;
  the initial UI target is site-wide thermal cooling demand, with other targets undefined.
- Pilot policy, anomaly evaluation, investigation cadence and outcome criteria.
- Feedback collection, training algorithms, datasets and domain evaluation suites.
- Packaging format, process layout, release dependency pinning, artifact distribution,
  service management, resource budgets and recovery procedures.
- Maintained PHYVAC upgrade process, recovered upstream provenance and the recorded
  fork-modification redistribution permission before customer delivery.
- Measured site fidelity, calibration data quality/windows, power/energy evaluation,
  supported extensions beyond the current topology family and physical model limits.

Do not infer choices from a prototype, dependency import, or empty directory. The
modified PHYVAC foundation and one-device/one-site/local-operation constraints are
already decided; the open decisions must fit within them.

## 13. Working, testing, and data-handling agreements

Use the owner's designated DGX Spark for project execution/testing, logging in as
`ghani`. Use an isolated checkout and virtual environment and preserve existing
deployments. Connection details are private and may be available in ignored
`.local/dgx-spark.md` or the current session. If unavailable, request them through
the appropriate private channel rather than guessing. This portable prompt contains
no passwords, private host addresses, or reusable credentials.

Typical Python setup/test commands, when authorized and appropriate for the branch:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e ".[dev]"
.venv/bin/python -m pytest
```

Read the checked-out branch's setup instructions first. GitHub CI supplements DGX
testing; it does not replace it. State the commit, environment, checks actually run,
results, and limitations. For documentation-only edits, check consistency, links,
and the diff; do not imply that historic DGX results validate a new code revision.

Implement on branches and land through PRs rather than directly on `main`. Respect
existing changes, avoid broad unrelated fixes, and do not merge/deploy simply because
a test suite passes or a context file mentions it as a future step. Follow the
owner's task-specific authorization for external reviews or publication.

Keep credentials, customer CAD, telemetry, generated site assets, indexes, databases,
training datasets, model weights and checkpoints out of Git and out of this prompt.
Use ignored local/runtime storage; commit source, sanitized examples, and evidence
that can be shared. Never reproduce session credentials in PRs, logs, or handoffs.

## 14. Source map for the next LLM

- [AGENTS.md](AGENTS.md): repository working agreements and scope boundaries.
- [PRODUCT.md](PRODUCT.md) and [PRODUCT-zh.md](PRODUCT-zh.md): product intent in
  English and Chinese; keep both consistent when the owner changes scope.
- [docs/architecture.md](docs/architecture.md): ownership, dependencies, shared
  artifacts, physical/presentation separation, and local runtime boundaries.
- [docs/reference-review.md](docs/reference-review.md): prototype findings and
  development sequence; read the appropriate branch's version.
- [deployment/dgx-spark/README.md](deployment/dgx-spark/README.md): installation,
  commissioning and lifecycle requirements.
- [README.md](README.md) and module READMEs: branch-specific setup and responsibilities.
- [Dashboard engineering handoff](apps/dashboard/README.md): every UI folder/brief,
  common design requirements and assignment acceptance.
- [Version A record](apps/dashboard/VERSION_A.md) and
  [design](apps/dashboard/DESIGN.md) for the dashboard prototype's milestones,
  decisions and evidence.
- [Prediction backend handoff](src/hvac_agent/prediction/README.md),
  [prediction UI handoff](apps/dashboard/src/features/prediction/README.md) and
  [prediction API handoff](apps/api/routes/prediction/README.md): the exact connection
  from local model to full page and monitoring summary.
- [UI/data contract proposal](docs/ui-data-contracts.md): draft wire semantics;
  endpoints and schemas have not been implemented.
- [docs/simulation.md](docs/simulation.md): the merged simulation foundation, its
  supported topology and limitations.
- [Engine provenance](src/hvac_agent/integrations/phyvac/vendor/UPSTREAM.md): baseline,
  patches, license and known defects.
- [PR #2](https://github.com/yxiao986/hvac-agent/pull/2): simulation implementation and
  full review history.

Prefer the latest verified source for current behavior while preserving older
evidence with its original commit identity. Local review scratch files are not a portable source
of truth and may be absent on another machine.

## 15. Mandatory context-maintenance protocol

When you complete substantive implementation, review, testing, integration,
deployment, or planning work, update this file **in the same handoff**. Do not merely
append a transcript or ask the owner to remember what changed.

1. **Reconcile the starting state.** Check branch/commit, relevant PRs and owner
   instructions before relying on this snapshot. If offline, retain the last known
   state with its date and clearly identify what was not rechecked.
2. **Update the current sections in place.** Move work between planned,
   implemented-on-branch, reviewed, merged, deployed and validated only with evidence.
   Record commit/PR references; do not equate these statuses.
3. **Maintain unresolved work.** For each active finding, record whether it remains
   open, has a candidate fix, or has been verified resolved. Include fixing commit
   and regression evidence when resolved. Summarize superseded findings briefly
   instead of leaving them presented as current blockers indefinitely.
4. **Record validation precisely.** Include environment, exact revision, actual
   result and important limits. Separate unit/integration tests, synthetic
   simulations, reference comparisons, measured-site validation and release checks.
   An unrun test or an author's unverified claim is not a reproduced result.
5. **Preserve decisions and open questions.** Distinguish owner decisions,
   implementation choices, hypotheses and proposals. Explain meaningful changes
   and their consequences. Do not silently expand scope or select dependencies.
6. **Synchronize related documents where applicable.** Update `AGENTS.md`, both
   product descriptions, architecture, module READMEs and setup/deployment guidance
   when the work actually changes their claims. Avoid changing product intent just
   to match a temporary implementation limitation.
7. **Keep the prompt portable and safe to share.** No credentials, customer records,
   copied private logs, or machine-specific scratch paths. Cite durable repository
   sources and sanitized evidence. Preserve useful history without duplicating
   entire conversations or review bodies.
8. **Refresh the date and handoff entry.** Use the project/user timezone. State the
   scope completed, outstanding work and next dependency. Mention the context update
   in your final handoff. Routine conversation with no changed project facts does
   not need a fabricated progress entry.

If you cannot edit repository files, return a clearly delimited proposed replacement
or patch for the affected sections. Explicitly say that it has **not** been saved.
Do not claim durable memory or a file update that did not happen.

### Latest handoff

- **2026-10-28 — pushed `main` and brought the fork level, without a PR.** At the user's
  instruction ("push"): fetched `origin` (remote `main` unchanged at `efc0a0a`; the
  fork's `main` unchanged at `6e8217a`), committed this update, pushed `main` as a
  fast-forward, and pushed to the fork's `main` one commit on top of `6e8217a` whose tree
  is identical, without force. Bypasses the `AGENTS.md` PR and DGX-validation rule at the
  user's direction. Checks as in the entry below; browser tests not run; no DGX
  validation. Next dependency: the collaborators should pull the fork's `main`; a
  Playwright run, stage 4 authorization and DGX validation.
- **2026-10-28 — integrated the fork's 2026-10-27 Memory Graph work locally.** Replayed
  gabjaswilliam-del's `14310a4` onto `main` as `20b0166`, author kept; verified the fork's
  merge reverts nothing here; recorded it and updated the README milestone range.
  Typecheck, 215 unit tests and build pass; `pytest` not rerun (no Python change).
  Local `main` fast-forwarded; not pushed, no PR, browser tests not run, no DGX
  validation. Next dependency: the push decision (to `origin`, and the record to the fork
  to keep the files equal), a Playwright run, stage 4 authorization and DGX validation.
- **2026-10-23 — fork brought level with `main`.** At the user's request ("update their
  version with my version … both of them are equal"), chose to add one commit on the
  fork rather than force-push over its history. Pushed this context update to `main`
  and a commit to the fork's `main` whose tree is identical. No PR; no new code, so no
  new test run; browser tests and DGX validation still outstanding. Next dependency: the
  collaborators should pull the fork's `main` before further work, and later fork
  updates still need replaying here because the histories differ.
- **2026-10-19 — pushed `main` with the fork update, without a PR.** At the user's
  instruction ("push to main"): fetched `origin` (remote `main` unchanged at `ae9c139`),
  committed this update and pushed `main` as a fast-forward. Bypasses the `AGENTS.md` PR
  and DGX-validation rule at the user's direction. Checks as in the entry below; browser
  tests not run; no DGX validation. Next dependency: a Playwright run, stage 3 and 4
  authorization in `AGENTS.md`, and DGX validation.
- **2026-10-19 — integrated the fork's 2026-10-17 commits locally.** Replayed the RAG
  Graph redesign (M7.2, M7.3) and the fixture-only CAD Studio onto `main` at `ae9c139` on
  `feat/fork-update-2026-10-17`, authors kept; resolved three overlap conflicts without
  changing the owner's 2026-10-15 behaviour; fixed a leftover "Analytics" test link.
  Typecheck, 198 unit tests, build and `pytest` (554 passed, 4 xfailed) pass locally.
  Local `main` fast-forwarded (pushed the same day, entry above); no PR, browser tests
  not run, no DGX validation. Next dependency: the push decision, a Playwright run, stage 3 and 4
  authorization in `AGENTS.md`, and DGX validation.
- **2026-10-16 — pushed `main` to `origin` without a PR.** At the user's instruction
  ("push to main"): fetched `origin` (remote `main` unchanged at `6b9fa28`), fast-forwarded
  the local `main` to `feat/prediction-vs-actual` (`a8b610a`), committed this update and
  pushed `main`. This bypasses the `AGENTS.md` PR and DGX-validation rule at the user's
  direction. Before pushing: `pytest` 553 passed, 4 xfailed; dashboard typecheck, 192
  unit tests and build pass; no outgoing commit carries an AI co-author trailer.
  Browser tests not run; no DGX validation. Next dependency: Playwright run, stage 4
  authorization in `AGENTS.md`, and DGX validation including the dashboard build and tests.
- **2026-10-16 — dashboard owner changes committed on `feat/prediction-vs-actual`.** At
  the user's requests: prediction-against-actual page, Prediction tab, plant running only
  while played, Run simulation on the deck, simulation/replay mutual exclusion, AI Pilot
  starting the simulation, and the AI display with the `show_on_display` tool (section 6).
  Typecheck, 192 unit tests and the build pass locally; browser tests not run; not pushed,
  no PR, no DGX validation. An incidental `package-lock.json` change from the local npm
  (dropped `libc` markers) was discarded. Next dependency: running the Playwright suite,
  stage 4 authorization in `AGENTS.md`, the push/PR decision for local `main` and this
  branch (pushed to `main` the same day, entry above), and DGX validation.
- **2026-10-14 — dashboard merge fast-forwarded into local `main`.** At the user's
  instruction ("merge it to main"), fast-forwarded the local `main` from `6b9fa28` to the
  merge commit `404ee4d` without a pull request, then committed this context update. This
  bypasses the `AGENTS.md` PR and DGX-validation rule at the user's direction. Not pushed
  when this entry was written; no DGX or dashboard `npm` validation. Next dependency: the
  push decision, `AGENTS.md` authorization for the stage 4 work, and DGX validation
  including the dashboard build and tests.
- **2026-10-14 — merged the Version A dashboard fork on `feat/dashboard-ui`.** At the
  user's request, created `feat/dashboard-ui` from `main` at `6b9fa28` and merged a
  cleaned copy of gabjaswilliam-del's fork (section 6): AI co-author trailers and
  workstation-specific tooling files removed from its seven commits, authorship kept.
  Resolved twelve documentation conflicts, updated dashboard and product status lines,
  and committed this file including the previously uncommitted 2026-10-12 reconciliation.
  `pytest` on the merged tree on the user's macOS workstation: 553 passed, 4 xfailed.
  Not pushed, no PR, no DGX or dashboard `npm` validation. Next dependency: owner review
  of the stage 4 scope and `AGENTS.md` authorization, then push, PR, and DGX validation
  including the dashboard build and tests.
- **2026-10-12 — pulled latest main and preserved local context.** Pulled from
  `e7b29be` to `6b9fa28` using fast-forward only. Incoming changes are documentation:
  prediction-backend scope/status and an optional forecast `requested_mode`, with
  automatic selection excluding baselines and explicit mode selection advertised
  through capabilities. Resolved the autostash conflict in this file by retaining
  upstream decisions and the saved independent review evidence/handoffs. Verified
  matching local/remote commits, Markdown links and no unresolved conflict markers.
  This reconciliation remains uncommitted. No runtime tests, implementation,
  prediction-branch review or deployment were performed during the pull.
- **2026-10-11 — PR #2 merged; prediction backend authorized.** GitHub shows PR #2
  approved at `ac0697e` on 2026-10-10, with the third-review fix verified on the DGX,
  and merged as `e7b29be`. The owner authorized the stage 5 prediction backend only,
  confined to `src/hvac_agent/prediction/`, `tests/` and prediction documentation;
  `feat/prediction` was created from `e7b29be`. Updated `AGENTS.md`, this file
  (status, compressed review history, roadmap, source map), `README.md` and two
  dashboard READMEs that still described the simulation code as unmerged. Committed
  directly to `main` without a PR at the owner's instruction. Documentation only; no tests were
  rerun. Next dependency: fast-forward `feat/prediction` to this commit, then agree
  the prediction contracts and build the input preparation and baseline.
- **2026-10-10 — PR #2 merged and local main updated.** Owner explicitly requested
  the merge and local update. Merged the approved head `ac0697e` using a merge
  commit, verified PR #2 merged at `e7b29be`, and fast-forwarded the local `main`
  branch to that same commit. Saved the pending review-context edit before the
  update and reconciled it with the merged implementation context, preserving
  independent and author-run evidence. Confirmed the merge tree is identical to
  the DGX-tested PR head; no runtime changes or new runtime tests were introduced.
  Main CI passed, local/remote commits match, and context links/whitespace were checked.
  This context refresh remains local and uncommitted. No deployment was performed.
- **2026-10-10 — fourth simulation review, approved.** Reviewed PR #2 at `ac0697e`
  and verified fix `1b3e1c3`. Independently ran 491 passed/4 xfailed on the designated
  DGX in a fresh environment. Original zero-condenser-flow, symmetric starvation,
  recovery, trickle-envelope and 78 branch-balance checks passed. Submitted approval
  with no remaining blocker in the reviewed changes. Updated this context locally;
  At the review handoff PR #2 was unmerged; it was subsequently merged at the
  owner's request as recorded above. Measured fidelity, calibration and standalone
  release acceptance remain separate work.
- **2026-10-06 — author's third-review fix.** Candidate fix `1b3e1c3` added the
  two-sided water-flow guard, per-chiller outlet envelope checks and two regression
  tests, documented in `ac0697e`. Author-run validation and the unchanged reference
  comparison are retained in section 8. The candidate was independently verified
  and approved on 2026-10-10.
- **2026-10-05 — third simulation review submitted, changes requested.** Reviewed
  PR #2 at `b0d90c9`, including its merge of main `d21c5e5`. Independently reproduced
  489 passed/4 xfailed on the designated DGX in an isolated environment, verified
  all four second-review fixes, and checked 240 further unequal-speed hydraulic
  cases. Reproduced one P1 blocker: zero condenser flow still permits chiller
  cooling and impossible good-quality outlet temperature. Submitted the linked
  third review with exact commands, observations and required regression coverage.
  Updated this context locally; no implementation, merge or deployment is included.
  At that time the next dependency was the zero-condenser-flow fix, now verified
  resolved in the fourth review recorded in section 8.
- **2026-10-05 — author's second-review fixes and merge of main into PR #2.**
  Candidate fixes `2f7b479`, `62055f0`, `9fcd6a2` and `e32d2dc`, documented in
  `e217136`, passed author-run validation. Main `d21c5e5` was incorporated into
  the simulation branch at `b0d90c9`, retaining both sides of the AGENTS and module
  README changes. These fixes were independently verified in the third review.
- **2026-10-04 — documentation published to main.** The owner authorized a direct
  push. Published `d21c5e5` from main base `85093f8`, including the living context
  prompt and UI/prediction handoffs, and verified remote main and a clean worktree.
  PR #2 remained separate at `3d5663d` with changes requested at publication time.
  Documentation links, structure, Git inclusion and whitespace passed checks;
  runtime code was unchanged, so DGX/runtime tests were not rerun for that revision.
- **2026-10-01 — UI and prediction engineer briefs added.** Added screen/shared UI
  ownership folders and READMEs, backend prediction subfolder briefs, prediction API
  routes brief, and a common contract proposal. Updated product descriptions,
  architecture and relevant module README links. This is documentation only;
  frontend/backend frameworks and the model remain open, with no code or runtime
  tests added. The PR #2 review snapshot above is unchanged and was not re-reviewed
  by this documentation task. Local links, Markdown structure and whitespace are
  checked for the handoff; fixture and live-integration completion must be tracked
  separately when engineers implement their assignments.
- **2026-10-01 — context prompt created.** Consolidated owner requirements, merged
  scaffold, unmerged simulation work, two review rounds, evidence, roadmap and
  maintenance instructions. GitHub confirmed `main` at `85093f8` and PR #2 open at
  `3d5663d` with changes requested. This task changes documentation only; no
  simulation fixes, new feature implementation, merge or deployment were performed.
  Local document links, Markdown structure and whitespace were checked; no runtime
  tests were rerun for this documentation task.
  At that time the next dependency was resolution of the four second-review
  findings, now verified resolved as recorded in section 8.
