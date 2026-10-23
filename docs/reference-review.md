# Reference review and development plan

Two reference projects were reviewed. Both are idea references, not codebases to port.
Neither was run, and no benchmarks were reproduced. No source code, assets, datasets,
prompts, credentials, or configurations were copied, and both repositories were left
unchanged.

| Reference | Reviewed | Revision read | What it is |
|---|---|---|---|
| `../openclaw-hvac` | 2026-09-20 | `9591abe`, with an existing local change | Agent harness, cockpit dashboard, CAD studio, prediction experiments |
| `../simulate_ai` | 2026-09-21 | `5b452aa` | A PHYVAC fork plus per-site plant models, a stepwise simulation API, an RL stack, and a calibration harness |

Two cautions about revisions. `openclaw-hvac` has advanced past the commit this review
first read — `scripts/compose.py` and `bridge/hvac_simulation_system/cadstudio/` were
absent from an intermediate checkout and are present again at `323915a`, so verify a
cited path against the current tree before relying on it. `simulate_ai` is under active
development by its author; re-check its log rather than trusting an earlier reading.

The two references are two halves of one system. `openclaw-hvac`'s simulation client
points at the same host that `simulate_ai` uses for its telemetry database, over the
same ten-minute frame and the same action payload shape. What the first review described
as an opaque remote simulation dependency is the second reference, for which full source
is available.

The owner's requirements take precedence over legacy implementation and plans:
one standalone DGX Spark, one data center, a 2D monitoring-first dashboard, and
**modified PHYVAC as the simulation foundation**. No feature development is part
of this review.

## What openclaw-hvac clarifies

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
- **Installation is part of the deliverable.** The owner clarified that the whole
  product, including local models, storage, and installation jobs, lives on one DGX.
  Plan one repeatable installation/commissioning procedure and managed lifecycle;
  the prototype's manual multi-machine setup is not the deployment model.

## What simulate_ai clarifies

This reference matters more than the first for stages 1 and 2, because it is a working
PHYVAC integration rather than a client of one. Paths are relative to that repository.

| Observed source | Useful idea | How it informs this project |
|---|---|---|
| `phyvac.py` (4,924 lines, `ver20231120`) | A maintained fork of the selected foundation, self-contained apart from numpy, pandas, scipy, scikit-learn, matplotlib and openpyxl | A concrete candidate for the fork decision below, and the dependency set to validate on ARM64 |
| `Configuration/constant.py` | One `<device_id>:<metric>` vocabulary with per-point units, generated from device-ID lists | The metric catalog belongs in `core`. The same vocabulary appears independently in the other reference's control map and scene readout bindings, so it is stable across producers |
| `sim_platform/FuZhou/fu_zhou_sim_system.py` | Hydraulic closure is a one-dimensional bisection on header differential pressure, about 100 lines, not a network solve. PLC logic is separated into named staging and setpoint methods | The chiller-plant topology family is fixed in shape and varies only by unit counts, so the solver is parameterized rather than general |
| `sim_platform/*/config/*.py` | A plant is expressed as structure, performance curves, calibrated coefficients and control parameters; calibrated fields carry their pre-calibration values in comments | The field inventory a real site definition must cover, and an explicit separation between what a drawing can supply and what only fitting can |
| `Hyperparameter_Tuning/replay_runner.py`, `optimize.py` | Measured control actions can be replayed through the model and scored against measured points; the parameter search is a separate, resumable harness | Both the validation method for a generated plant and the eventual automatic calibration path |
| `sim_platform/desay_sv/desay_sv_plc.py` | The author eventually split control policy out of the plant model into its own module | Confirms the intended split: policy in `simulation`, physics behind the adapter |

Three measurements from this reference shape the delivery model.

**Hand-written plants do not scale.** `sim_platform/` has reached eleven sites and roughly
28,900 lines of plant code, averaging about 2,600 lines per site, with one site forked into
three versions totalling 13,305 lines. Little of that is difficult: the hydraulic closure in
the cleanest site is about 100 lines, and the remainder is repeated control logic, output
assembly and per-site hardcoding. A site should be assembled from a validated site
definition rather than written by hand.

**Drawings cannot produce a numerically accurate model.** Calibrating one site moved thirty
parameters away from their hand-set defaults by factors between 0.12x and 6.4x, in
inconsistent directions, so no general correction rule substitutes for per-site fitting.
This is the evidence for a two-tier delivery: a nameplate-parameter model available at
commissioning, and a calibrated model after several weeks of telemetry. The first tier is
not degraded — for fault detection it is preferable, because calibration absorbs any
degradation present in the fitting window.

**Energy was never fitted, so its accuracy is unknown.** The calibration objective in
`Hyperparameter_Tuning/tuning_config.py` weights nine points: four temperatures, four
pressures and one flow. No power point appears in it, and no energy figure appears in any
recorded result. Thirty-four parameters were searched over a thousand trials against forty
days of measurements, and what came out was a model fitted to temperatures and pressures
whose consumption nobody scored.

Its own validation errors, on days held out of the fit, are the reference point for what
accuracy is available from this approach at all:

| Point | Validation MAE |
|---|---|
| Chilled-water supply temperature | 0.20 K |
| Chilled-water return temperature | 2.51 K |
| Condenser-water supply temperature | 1.42 K |
| Condenser-water return temperature | 2.17 K |
| Header pressures | 6.5 to 13.5 kPa |
| Condenser-water flow | 76.6 m3/h |

Two things follow. First, agreement with this reference is a weak target: a model that
matched it exactly would inherit a 2.5 K error on chilled-water return temperature and an
unmeasured error on consumption. Comparison against it is useful for finding defects — it
found a real one, recorded in [docs/simulation.md](simulation.md) — but it is not
validation, and only measured data can be.

Second, it is the sharpest evidence for the two-tier split. A nameplate model answers
staging, capacity and fault-baseline questions from topology and manufacturer data alone.
Questions about consumption need measurements, and the reference shows that even a
thoroughly calibrated model does not answer them unless consumption was among the things
fitted.

## What must be redesigned from simulate_ai

- **There is no simulation run.** Resetting means discarding and rebuilding the plant
  object, and state can only be read by stepping. Our run state machine and a read that
  does not advance the clock are both additional work.
- **Observations are bare value maps.** No origin, run identity, or configuration revision,
  so real and simulated data are indistinguishable downstream.
- **The caller supplies a timestamp the engine does not use to advance time.** Nothing
  checks monotonicity or spacing, so the stated time and the internal state can diverge
  silently. The engine owns the clock here.
- **Per-site `step()` signatures differ** and the service layer dispatches on type. One
  interface, with site-specific inputs carried in configuration.
- **Actions are sent in full every step** because the backend has no partial-action support.
  Our action contract must accept a partial action.
- **Import-time side effects and module-level mutable state.** A database pool opens
  connections on import; an RL module keeps global staging memory that makes it
  non-reentrant.
- **The objective function is stored inside the plant configuration**, co-versioning the
  goal with the physics.
- **Credentials are committed.** Production database host, user and password appear in
  version control. None of that may enter this repository, and rotation should be raised
  with the author.
- **There are no tests.** Three files match a test naming pattern and none of them are
  tests. A characterization suite over the components we depend on is prerequisite work,
  not optional.

## Modified PHYVAC decision

The upstream project identified is
[ShoheiMiyata/phyvac](https://github.com/ShoheiMiyata/phyvac), a Python HVAC simulation
module with component documentation, system examples, and validation references.
This identifies the foundation, not an already selected custom fork. Before
integration, record the maintained fork URL, upstream commit, modification set,
dependencies, and upstream license/attribution information.

Two candidate baselines are now on the table. The decision is open.

| | Upstream | The `simulate_ai` fork |
|---|---|---|
| Size and revision | About 3,900 lines, current | 4,924 lines, `ver20231120`, roughly two and a half years behind |
| Additions | None | A parallel chiller group and a cooling tower bank |
| Compatibility | Reference specification sheets | Redefines the chiller specification sheet, so its spreadsheets are not interchangeable with upstream |
| Known defects | Two found while reading: a heat-exchanger helper called with the wrong arity on an untested path, and a staging comparison against the wrong threshold | Three that upstream has since fixed: a water-density polynomial whose higher-order coefficients are off by a factor of ten, two loops that never visit index zero, and a misspelled variable on an untested path |
| Consequence for validation | Nothing depends on it yet | All eleven reference plants build on it, so behavioural identity with it is what makes a comparison against those plants meaningful |

If the fork is adopted, do not correct its three defects immediately. They sit in a
stratified thermal storage tank and a gas absorption chiller — components outside the
water-cooled chiller plant family this project models, so nothing we assemble calls them.
Editing vendored code we do not exercise buys nothing and adds divergence for the next
upstream sync to carry. They become live if scope grows to include a buffer tank, at which
point they must be fixed first and whatever depended on the old numbers re-validated.

Pin them as expected-failure tests in strict mode, so that a future baseline or patch that
fixes one makes the suite fail rather than passing silently, forcing a decision.

That gives a general rule for touching a vendored engine: **patch what does not change
numbers, pin what does.** A compatibility fix whose results are provably unchanged must be
applied and recorded; a defect that moves numbers must not be corrected as a side effect of
something else.

A separate consequence of the same arithmetic is worth stating, because it cuts the other
way: a fault-detection baseline should use an *uncalibrated* model. Calibration fits
parameters to observed behaviour, so it absorbs whatever was degraded during the fitting
window and hides that fault afterwards.

### Licensing

The fork **does not carry the upstream license**. It has no license file, and the repository
contains no occurrence of BSD, copyright, University of Tokyo, or the redistribution clause;
the module header retains only the original author's handle. BSD-3-Clause attaches to the
code and is inherited, and a downstream fork cannot relicense it, so this is a compliance gap
in that repository rather than a change in obligation.

We must therefore ship the upstream notice ourselves, taken from upstream rather than from
the fork. Note that upstream has no root license file either — the text lives in its
`Documents/` directory and has to be copied explicitly. Because the simulator ships with the
product, this is distribution, so all three clauses bind, including the prohibition on using
the copyright holder's name to endorse the product. Citing the project's published paper is
academic courtesy, not a license term.

Separately, the fork's own modifications carry no declared license of their own. Obtain
written permission from their authors and record it, rather than assuming it.

### Environment validation

A preflight on the DGX confirmed the engine's dependency set installs and runs on aarch64:
numpy, pandas, scipy, scikit-learn, matplotlib and openpyxl all resolve, the module imports,
and psychrometric, pump, interpolation and workbook-reading paths all execute. Architecture
is not an obstacle.

One incompatibility surfaced. The fork predates NumPy 2.0 and converts single-element arrays
to scalars with `float()` in three places, which NumPy 2.x no longer permits, so the chiller
performance lookup raises `TypeError`. Upstream fixed exactly this in July 2026 by taking the
value with `.item()` instead, and records that results are unchanged — so under the rule
above it is a patch, not a pinned defect. Port only that change; upstream altered the same
lines to add clamping, which the fork already handles differently and which would change
results.

The DGX carries very recent versions, including pandas 3.0. Only chiller construction and a
single evaluation were exercised, so the dataframe handling in a full plant loop remains
unvalidated. Characterization baselines must be recorded on the DGX rather than on a
workstation, since library versions differ.

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

## Implementation sequence

Stages 1 and 2 are delivered; see [docs/simulation.md](simulation.md) for what was built
and what it is not yet good for. The rest is a dependency guide for future work, and each
later stage needs its own authorization.

| Stage | Deliverable | Evidence needed before the next dependent stage |
|---|---|---|
| 0. Local packaging design | Artifact inventory, DGX preflight, installation steps, data locations, and lifecycle ownership | Every required service, model, and storage component has a local deployment path; no second host or cloud service is required |
| 1. Site definition and contracts **— delivered** | Semantic topology, parameters, metric catalog, evidence/unknowns, revisions, and run/event boundaries | A reviewed synthetic site can be described without UI or simulator-specific IDs; physical and presentation changes are distinguished |
| 2. Modified PHYVAC foundation **— delivered** | Pinned fork, required component changes, adapter, run lifecycle, and baseline scenarios on DGX | Repeatable initial conditions; plausible energy/flow/temperature behavior; explicit coverage and calibration limits |
| 3. Installation and CAD workflow | Extract/review topology and sensor mappings; generate editable 2D scene and stateful assets | Equipment and connections are traceable to evidence; scene and simulator use the same validated site revision |
| 4. Integrated monitoring and harness | Local API, animated dashboard, telemetry, conversations, RAG, memory, and agent-driven data views | A question about a selected device uses the same device, time range, and observation source as the screen; missing data is visible |
| 5. Cooling prediction | Pretrained configuration-based path and historical-data adaptation path | Chronological backtests, baseline comparison, uncertainty, and clear demand/output/efficiency target definitions; no-history behavior is explicit |
| 6. Simulation AI pilot | Issue lifecycle, grounded investigation, validated corrections, and outcomes | Reproducible matched scenarios; stale/invalid actions rejected; model delays do not block the simulation clock; outcomes measured rather than assumed |
| 7. Domain LLM specialization | Domain evaluations and curated feedback, RLHF followed later by RLAIF | Measured gains and regressions against a baseline; feedback and model provenance; runtime fit within the DGX resource budget |
| 8. Standalone release acceptance | Complete installer, commissioning, startup/restart, update, and backup/restore procedure | Fresh-install and restart checks on DGX; the integrated product works without internet or another compute server, with local site connections retained |

This is a dependency guide, not a delivery schedule. Evaluation definitions and
trace/feedback design should begin early; expensive model training follows usable
workflows and adequate data. Stage 2 was built against a reviewed synthetic configuration,
as anticipated here, and stage 3 remains what connects it to a customer's drawings.
Packaging and installation work progress with the modules; stage 8 verifies the
complete product rather than deferring all installation work to the end.
