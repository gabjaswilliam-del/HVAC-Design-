# Reference review and development plan

Reviewed on 2026-09-20. `../openclaw-hvac` is an idea reference, not a codebase to
port. This review read local source and documentation (HEAD `9591abe`, with an
existing local change); it did not run the prototype or reproduce its benchmarks.
No source code, assets, datasets, prompts, credentials, or configurations were copied.
The reference repository was left unchanged.

The owner's requirements take precedence over legacy implementation and plans:
one standalone DGX Spark, one data center, a 2D monitoring-first dashboard, and
**modified PHYVAC as the simulation foundation**. No feature development is part
of this review.

## What the reference clarifies

Paths in this table are relative to the reference repository, not this project.

| Observed source | Useful idea | How it informs this project |
|---|---|---|
| `cockpit/src/App.tsx`, `view/types.ts`, `view/viewChannel.ts` | An agent can present a station view, charts, tables, and equipment highlights in one workspace | One dashboard with typed presentation requests, separate from commands that change a simulation |
| `cadstudio/README.md`, `scripts/compose.py`, `bridge/hvac_simulation_system/cadstudio/design_tools.py` | Equipment, ports, connections, layout, and readouts can be represented before rendering; design edits can be validated | A versioned semantic site definition plus a separate scene/layout model; both visual and simulation artifacts refer to the same site revision |
| `bridge/hvac_simulation_system/cadstudio/generate.py`, `scripts/cad_to_2d.py` | CAD extraction, layer selection, equipment recognition, deduplication, and operator editing are distinct stages | Preserve evidence and unknowns; identifying equipment counts does not prove real piping connections |
| `bridge/hvac_simulation_system/hvac_icons.py` | Generate and cache equipment artwork independently from the equipment model | Asset generation belongs to installation; rendering/animation must still distinguish operational states |
| `bridge/hvac_simulation_system/sim_controller.py` | A simulation has start, step, play, pause, stop, observations, and control actions | Preserve the lifecycle concept while replacing the remote replay architecture with local modified PHYVAC |
| `bridge/hvac_simulation_system/hvacclaw.py` | Streaming tool execution, task budgets, cancellation, data retrieval, memory, and UI feedback form the harness | One governed tool interface across modules, with visible progress and explicit partial/error results |
| `bridge/hvac_simulation_system/autopilot.py`, `pilot_episodes.py` | Periodic screening can trigger deeper investigations; recurring issues have an outcome history | Track detection → investigation → proposed correction → application → measured outcome, without blocking simulation stepping |
| `bridge/hvac_simulation_system/hvac_kb.py`, `hvac_memory.py`, `hvac_db.py` | Engineering references, conversational memory, and operational measurements serve different purposes | Keep RAG, agent memory, and telemetry separate; preserve citations, units, timestamps, and source identity |
| `prediction/common/dataset.py`, `backtest.py`, `runner.py`, `ledger.py` | Distinct prediction targets, chronological evaluation, and reproducible experiment records | Evaluate forecasts against baselines and retained history; keep cooling demand, delivered cooling, and COP distinct |

## What must be redesigned

- **Documentation is not a reliable implementation inventory.** The root README
  describes an older OpenClaw bridge; the current `hvacclaw.py` implements a focused
  runtime, and the cockpit source connects to live APIs despite its README describing
  mocks. Earlier CAD evaluations also describe gaps later addressed in source. Read
  these as evolving prototypes, not a verified feature checklist.
- **The old simulator is a remote dependency.** `SimSession` calls backend replay
  endpoints; this is not a local PHYVAC integration. Reuse the lifecycle idea, not
  its URLs, record IDs, device lists, or remote service arrangement.
- **The current pilot advises.** Its source does not apply corrections, despite an
  earlier plan describing autonomous optimization. Our planned simulation correction
  loop is additional work, with explicit action validation and outcome measurement.
- **A conventional diagram is not the site's physics.** The prototype's composer
  builds a fixed plant pattern from family counts. Preserve the separation of design
  and rendering, but obtain actual connectivity and operating parameters from CAD
  evidence, equipment documentation, and installation review. Mark unsupported
  devices and unknown connections rather than inventing them.
- **Shared identity needs explicit contracts.** Avoid duplicated device catalogs,
  hardcoded plant sizes, implicit timestamp conversions, and UI-specific frame
  shapes. Use common equipment/metric definitions and explicit observation origin,
  units, sample time, simulation run, and configuration revision.
- **Single-site operation changes the design.** Do not carry over station selectors,
  multi-platform session registries, or cross-site memory ranking. Conversation,
  operator, equipment, and simulation-run identities still have legitimate roles.
- **Keep measurements separate from claims.** Forecast rankings from the prototype
  are not validated for this installation. COP regression is not automatically a
  future forecast. A savings estimate against a fixed reference COP does not replace
  a matched baseline/controller experiment. LLM RLHF/RLAIF is also distinct from a
  reinforcement-learning equipment controller.
- **One DGX has a shared resource budget.** Do not inherit the prototype's split
  VM/GPU/remote-engine deployment or model selections. Schedule expensive inference,
  image generation, and adaptation so monitoring and simulation remain responsive.

## Modified PHYVAC decision

The upstream project identified is
[ShoheiMiyata/phyvac](https://github.com/ShoheiMiyata/phyvac), a Python HVAC simulation
module with component documentation, system examples, and validation references.
This identifies the foundation, not an already selected custom fork. Before
integration, record the maintained fork URL, upstream commit, modification set,
dependencies, and upstream license/attribution information.

Our ownership split is:

- `core`: validated site topology, equipment identities, units, and shared contracts.
- `simulation`: scenario inputs, simulation time and lifecycle, baseline/controller
  orchestration, normalized results, and comparison/evaluation workflows.
- `integrations`: adapter translating site configuration and actions into the
  modified PHYVAC engine's actual interface. No upstream method names are assumed yet.
- `pilot`: assessment and correction policy; it requests simulation actions through
  the simulation interface rather than mutating PHYVAC internals.
- `deployment/dgx-spark`: the eventual packaging and local resource allocation for
  the chosen fork. The fork's code location/package strategy remains undecided.

Modification planning must cover the installed equipment types, performance curves,
hydraulic/thermal connections, demand and weather inputs, time stepping, controls,
initialization/reset, fault scenarios, and observable outputs. Validate component
coverage, units, numerical behavior, and ARM64 dependencies against the chosen
revision. Determine any data-center-specific thermal components that need extending;
do not assume upstream already models the whole data center.

## Proposed implementation sequence — future work only

| Stage | Deliverable | Evidence needed before the next dependent stage |
|---|---|---|
| 1. Site definition and contracts | Semantic topology, parameters, metric catalog, evidence/unknowns, revisions, and run/event boundaries | A reviewed synthetic site can be described without UI or simulator-specific IDs; physical and presentation changes are distinguished |
| 2. Modified PHYVAC foundation | Pinned fork, required component changes, adapter, run lifecycle, and baseline scenarios on DGX | Repeatable initial conditions; plausible energy/flow/temperature behavior; explicit coverage and calibration limits |
| 3. Installation and CAD workflow | Extract/review topology and sensor mappings; generate editable 2D scene and stateful assets | Equipment and connections are traceable to evidence; scene and simulator use the same validated site revision |
| 4. Integrated monitoring and harness | Local API, animated dashboard, telemetry, conversations, RAG, memory, and agent-driven data views | A question about a selected device uses the same device, time range, and observation source as the screen; missing data is visible |
| 5. Cooling prediction | Pretrained configuration-based path and historical-data adaptation path | Chronological backtests, baseline comparison, uncertainty, and clear demand/output/efficiency target definitions; no-history behavior is explicit |
| 6. Simulation AI pilot | Issue lifecycle, grounded investigation, validated corrections, and outcomes | Reproducible matched scenarios; stale/invalid actions rejected; model delays do not block the simulation clock; outcomes measured rather than assumed |
| 7. Domain LLM specialization | Domain evaluations and curated feedback, RLHF followed later by RLAIF | Measured gains and regressions against a baseline; feedback and model provenance; runtime fit within the DGX resource budget |

This is a dependency guide, not a delivery schedule. Evaluation definitions and
trace/feedback design should begin early; expensive model training follows usable
workflows and adequate data. Stage 2 can use a reviewed synthetic configuration while
the CAD workflow is developed. Do not begin these stages as part of this review.
