# HVAC Agent — living project context prompt

**Last updated:** 2026-10-04 (Asia/Shanghai)

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

The API composes backend modules and application lifecycle. No dashboard framework
or API transport has been selected. Neither application is implemented in the
verified snapshot below.

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

## 6. Verified project state as of 2026-10-01

This snapshot was checked against GitHub on the date above. It is branch-specific.

| Item | Verified state |
|---|---|
| PR #1 — modular scaffold | [Merged](https://github.com/yxiao986/hvac-agent/pull/1) on 2026-09-20 |
| `main` | `85093f81ccaa6220de5b65c49741a1704e5f048c`; scaffold and product/architecture/reference/deployment documentation |
| Local checkout when this prompt was written | `chore/modular-single-site-structure` at `95f08a0`; scaffold branch, not the simulation branch |
| PR #2 — simulation foundation | [Open](https://github.com/yxiao986/hvac-agent/pull/2), **changes requested**, not merged |
| PR #2 branch and reviewed head | `feat/simulation-foundation`, `3d5663d8b9eaea7d0bfe9e0dbfecf7a6515858d1` |
| Integrated standalone application | Not implemented or released |
| Customer/site commissioning and physical validation | Not completed |

The scaffold's README/product documents describe a scaffold because that is what
exists on that branch and on `main`. The PR's documentation describes stages 1 and
2 as delivered because their code exists on the PR branch. Neither statement means
that the PR is approved, merged, calibrated, or ready for customer deployment.

Initial work authorized folder structure and documentation. The PR branch's
`AGENTS.md` records later authorization for stages 1 and 2: site contracts and the
simulation foundation, confined to core/simulation/integrations, configuration,
tests, and associated documentation. Later product stages require their own task
authorization. Creating or reading this context prompt does not extend that scope.

On 2026-10-01 the owner requested folder-local UI and cooling-load prediction
instructions for junior engineers. That task added README briefs and a draft data/API
contract, not feature code. Engineers assigned these modules should start at the
dashboard/prediction handoffs below. Draft endpoint names are not existing services.

| Capability | What exists | What remains |
|---|---|---|
| Modular layout and product definition | Merged scaffold, ownership READMEs, product descriptions in English/Chinese, architecture and installation requirements | Keep synchronized with verified implementation and owner decisions |
| Site contracts and metrics | Implemented in PR #2 | Resolve review issues and integration/acceptance needs; not merged |
| Modified PHYVAC and simulation lifecycle | Implemented in PR #2 with tests | Remaining correctness findings, review/merge, measured fidelity work |
| CAD Studio, generated assets, editable scene | UI folder brief and backend responsibility documented | Implementation and commissioning workflow |
| Dashboard/API and telemetry ingestion | Per-screen/shared UI briefs, ownership folders and draft API/data contracts. Version A fixture prototype on local branch `feat/dashboard-version-a`: M0–M5 implemented (shell, approved artwork, fixture data layer, interactive monitoring with KPI details, cooling prediction and equipment pages, scripted AI assistant); not pushed, no PR, M5 awaiting owner review | Version A M6–M8 after owner review of M5; API framework, adapters, storage and integrated implementation |
| Harness, local model serving, RAG and memory | Responsibility/plan only | Implementation, curated content, model selection/evaluation |
| Cooling prediction and installation adaptation | Backend subfolder briefs, API route brief, full-page/monitoring UI brief | Models/data pipeline, no-history path, backtesting and uncertainty |
| Simulation AI pilot | Responsibility/plan only; supporting action/run contracts in PR #2 | Monitoring/diagnosis policy, issue workflow, tool integration and evaluation |
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

On 2026-10-04 the owner selected React 19 + TypeScript + Vite for the dashboard
(Version A "Industrial Control Center" prototype; a separate Version C design is
deferred). Tokens live in `apps/dashboard/src/styles/tokens.css`. The API framework
and prediction model remain undecided. UI fixture demonstrations must not claim live integration, model
accuracy, successful installation or physical equipment control.

## 7. What PR #2 currently implements

Read the PR version of `docs/simulation.md`, configuration guidance, code, and tests
before changing this foundation. These files may not exist on the scaffold branch.

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
  current PR semantics, not a physical equipment control design.
- Distinct reported demand/removed cooling/unmet cooling/loop heat accumulation,
  engine quality notes, and operating-envelope failure reporting.
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

The PR vendors a `simulate_ai` fork of upstream
[ShoheiMiyata/phyvac](https://github.com/ShoheiMiyata/phyvac), using baseline commit
`5b452aa23474216a76d1e57b1d104cef123e1c04`, engine string `ver20231120`.
The exact upstream commit is unknown. Its provenance, source location, license
notice, and reproducible patches are recorded in
`src/hvac_agent/integrations/phyvac/vendor/UPSTREAM.md` on the PR branch.

A NumPy 2 compatibility patch uses `.item()` for scalar extraction. Four strict
expected-failure checks pin defects in storage/absorption components outside the
current topology family. Do not enable those components without resolving the
defects and validating affected results. Vendor changes should have recorded patches,
reasons, tests, and DGX characterization; do not silently edit vendored arithmetic.

The upstream BSD-3-Clause notice is included. The PR records unresolved permission
to redistribute the fork authors' modifications; resolve and document that before
customer distribution. Do not infer that the copied upstream notice resolves every
fork-specific right or claim permission has already been obtained.

The backend requires Python 3.11+. PR #2 declares NumPy, pandas, SciPy, openpyxl,
matplotlib, scikit-learn, and PyYAML, plus pytest for development. Some libraries
are inherited from engine imports, not product technology selections. Inspect the
actual branch's `pyproject.toml`; do not claim its dependency set is present on the
scaffold or that release dependency locking has been solved.

## 8. Review status, evidence, and immediate unfinished work

PR #2 has received two submitted request-changes reviews. These are engineering
findings with synthetic reproductions, not measurements of the real data center.

### First review: fixes present at the latest reviewed head

At `d625107959a6563924ba5d88810d606db1680626`, the review found ignored topology
links, cooling metrics reconstructed from demand, incorrect per-device command
routing/ignored stop commands, baseline values masquerading as frequency feedback,
incorrect action application history, and display settings affecting physics.

The updated head `3d5663d` addresses those six reproductions with corresponding
regression coverage. Keep that coverage. The first review is
[recorded here](https://github.com/yxiao986/hvac-agent/pull/2#pullrequestreview-5363041134).

### Second review: four unresolved findings at `3d5663d`

The [follow-up review](https://github.com/yxiao986/hvac-agent/pull/2#pullrequestreview-5368901805)
requests these changes:

| Priority | Finding and reproduction | Required behavior |
|---|---|---|
| P1 | `integrations/phyvac/hydraulics.py`: unequal-speed fallback scales a pump's flow to close mass balance without satisfying its pressure equation. Example: reported header 123.531 kPa, slower-pump flow 0.122943 m³/min, but the same branch produces only 116.168 kPa at that flow. | Use a physically consistent operating-point/check-valve model or reject unsupported points; test pressure-flow relations as well as total mass balance. |
| P2 | `simulation/dispatch.py`: header pumps are consumed as exclusive per-chiller assignments. An accepted two-chiller configuration with one common-header pump per side starts only one chiller when the controller asks for two, capping reported cooling near 697.67 kW at 1,000 kW demand. | Model shared-header allocation correctly within flow constraints, or explicitly reject the unsupported arrangement during loading. |
| P2 | `integrations/phyvac/plant.py`: per-chiller temperatures are copied from mixed loop state. Actual outlets 9.5 °C and 8.41526 °C both appear as 8.95763 °C; next-step return is reported as the completed step's inlet. | Report each device's actual completed-step inlet/outlet values; keep mixed header values on system points and define stopped-device behavior. |
| P2 | `core/actions.py`: a frozen Action retains the caller's mutable setpoint dictionary. Changing an accepted 9.5 °C command to 20 °C before stepping bypasses the configured 7–12 °C limits and rewrites the proposal history. | Copy/freeze command values before validation; use the same immutable snapshot for the queue and ledger; test caller mutation after submission. |

Do not silently mark these resolved because code changed or a thread was closed.
Verify the relevant fix at a new commit and update this section with its evidence.
Do not require support for every topology family to resolve this review; enforce
correct behavior and honest rejection within the declared family.

### Verified test results

| Reviewed commit | Environment and result | What it establishes |
|---|---|---|
| `d625107` | Designated DGX Spark, isolated checkout/venv: 388 passed, 4 xfailed | Earlier suite passed despite six targeted correctness findings |
| `3d5663d` | Designated DGX Spark as `ghani`, ARM64, isolated checkout/venv: 463 passed, 4 xfailed; GitHub CI passed at review | Original regressions have coverage; four additional targeted reproductions still fail the intended behavior |

These are historical results for exact commits, not tests newly run while writing
this prompt. No full product, installed deployment, forecasting system, pilot,
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

Detailed source-based findings live in `docs/reference-review.md`; the simulation
branch contains later additions beyond the scaffold version.

## 10. Remaining product roadmap

This is a dependency guide and status inventory, not a schedule or instruction to
start implementation. Resolve the active simulation review before treating that
foundation as accepted for dependent work.

| Stage | Remaining outcome |
|---|---|
| 0. Local packaging design | Artifact inventory, resource budgets, preflight, data locations, service/lifecycle ownership and a local deployment path for every dependency |
| 1. Site contracts | Complete review/merge of PR contracts and prove consistency across future scene, telemetry, simulator and model bindings |
| 2. Simulation foundation | Resolve current correctness findings, re-review/merge, define fidelity criteria and measured validation/calibration workflows |
| 3. CAD and installation workflow | Extract/review topology, capture unknown parameters and sensor mappings, generate editable scene and state-aware assets locally |
| 4. Integrated monitoring and harness | Local API/dashboard/telemetry, tools and conversations, local model serving, RAG, memory and grounded data views |
| 5. Prediction | Pretrained no-history route, historical-data adaptation, chronological backtests, baselines and uncertainty |
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

- API transport, harness framework and tool protocol. (Dashboard framework decided 2026-10-04: React 19 + TypeScript + Vite.)
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
- [Prediction backend handoff](src/hvac_agent/prediction/README.md),
  [prediction UI handoff](apps/dashboard/src/features/prediction/README.md) and
  [prediction API handoff](apps/api/routes/prediction/README.md): the exact connection
  from local model to full page and monitoring summary.
- [UI/data contract proposal](docs/ui-data-contracts.md): draft wire semantics;
  endpoints and schemas have not been implemented.
- [PR #2](https://github.com/yxiao986/hvac-agent/pull/2): implementation and review state.
- [Simulation guide at the reviewed commit](https://github.com/yxiao986/hvac-agent/blob/3d5663d8b9eaea7d0bfe9e0dbfecf7a6515858d1/docs/simulation.md): current foundation and limitations.
- [Engine provenance at the reviewed commit](https://github.com/yxiao986/hvac-agent/blob/3d5663d8b9eaea7d0bfe9e0dbfecf7a6515858d1/src/hvac_agent/integrations/phyvac/vendor/UPSTREAM.md): baseline, patches, license and known defects.

The commit-pinned links document this snapshot, not future PR heads. Prefer the
latest verified source for current behavior while preserving older evidence with
its original commit identity. Local review scratch files are not a portable source
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

- **2026-10-04 — Version A M5: scripted AI assistant (awaiting owner review).**
  Assistant drawer (own shell column, plant refits), `/agent` page with history and
  tool list, streamed turns with visible simulated tool calls and typed views, and
  navigation from answers to equipment, plant, issues, KPI panels and the exact
  forecast. No language model: keyword-matched scripted investigations whose
  figures come from simulated tools over the synthetic data; clearly labeled; no
  recommendations or equipment control. An `AgentClient` interface and event/view
  contract (`apps/dashboard/src/lib/contracts/agent.ts`) are the replacement seam for
  a local-LLM harness and M6 simulation tools. Validation (Windows 11 workstation):
  typecheck and build pass; 41 unit and 84 browser tests pass on five consecutive
  runs. Not done: DGX validation, any real model or harness. Local commits only.
- **2026-10-04 — Version A M3.1 (KPI details) and M4 (awaiting owner review).**
  All nine monitoring KPI cards open an indicator details panel (shared side column
  with the equipment inspector) showing reported inputs, quality, trend and related
  equipment; Open issues shows the scenario's issues with evidence and Locate/Inspect
  actions; demand/delivered panels show shortfall periods against running capacity.
  M4 added `/prediction` (capabilities-driven controls, provenance, readiness,
  earlier-forecast comparison, pinned forecast links, honest unavailable/stale
  states; the forecast is a labeled demo baseline, not a trained model) and
  `/equipment/:id?` (filters, shared inspector, locate on plant). Fixed a cold-load
  bug where the schematic could stay undrawn. Validation (Windows 11 workstation,
  Node 24.19, Playwright 1.63 Chromium): typecheck and build pass; 28 unit and 70
  browser tests pass on three consecutive runs. Not done: DGX validation, live API
  or model integration, M5–M8. Commits are local only.
- **2026-10-04 — Version A Milestones 2–3 (awaiting owner review of M3).** Owner
  approved the M1 artwork and recorded eight M3 acceptance requirements (fit to
  screen, zoom controls, wheel/drag, clickable equipment, selection highlight and
  inspector, no cropping when panels open, preserved artwork, multi-resolution
  reachability); they are listed with test evidence in `apps/dashboard/VERSION_A.md`.
  M2 added zod boundary contracts, seven deterministic synthetic scenarios, a fixture
  `DataClient` with failure injection, and a seasonal-profile forecast baseline that
  provably uses no post-cutoff data and is labeled as a demo baseline. M3 added the
  interactive monitoring screen, shared equipment inspector, playback, KPI strip,
  issues and forecast summary. Validation (Windows 11 workstation, Node 24.19,
  Playwright 1.63 Chromium): typecheck passes; 23 unit tests and 32 browser tests
  pass, including fit at 1280×720–2560×1440 and pan/click reachability of all 16
  equipment items. Not done: DGX build/test, touch pinch-zoom, M4–M8 screens. Still
  fixture-only; no API, PHYVAC, model or equipment connection.
- **2026-10-04 — Version A dashboard prototype, Milestones 0–1 (awaiting owner
  approval of M1).** Owner authorized a fixture-only frontend prototype within
  `apps/dashboard/`. On local branch `feat/dashboard-version-a` (from `main`
  `85093f8`; not pushed, no PR): Vite/React/TS setup, tokens, shell with all routes
  (later screens are temporary "in development" stand-ins), English string catalog,
  draft topology contract, a synthetic 3-chiller/4-tower/4+4-pump demo plant in the
  `water_cooled_chiller_plant_v1` family with PR #2-style evidence (inferred pairings,
  unknown standby links), original SVG equipment artwork (chiller, pump, cooling tower,
  data-hall terminal) with running/stopped/fault/no-data/stale/selected states, pipes
  with flow animation, valves, sensors and measurement tags, a static monitoring
  scene preview and a dev-only asset sheet. Not connected to any backend or PHYVAC.
  Validation (Windows 11 workstation, Node 24.19, Chromium via Playwright 1.63):
  typecheck and production/demo builds pass; 9 browser tests pass (navigation/focus,
  narrow drawer, bundled font and tabular figures, axe serious/critical on `/` and
  one stand-in route, scene IDs/states, animation only for running equipment,
  reduced motion). Not done: DGX build/test, pytest (unavailable locally; no Python
  changed), interaction/zoom/playback/forecast and other screens (M2–M8). The
  2026-10-01 briefs and this file remain uncommitted working-tree changes.
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
  The next simulation dependency remains resolution and verification of the four
  active findings in section 8.
