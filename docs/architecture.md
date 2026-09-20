# Module boundaries

This is the intended structure, not an implemented system. The deployment unit is
one data center on one DGX Spark. Directories express ownership and dependencies;
they do not prescribe separate processes, containers, or services.

The simulation foundation is the owner's selected modified PHYVAC. Workflow lessons
from `openclaw-hvac` and the proposed development sequence are documented in
[reference-review.md](reference-review.md); no implementation is copied from it.

## Local product boundary

All product services, compute, and storage reside on the same DGX Spark. This
includes local LLM/image/embedding serving, CAD generation, retrieval and memory,
databases, prediction/adaptation, modified PHYVAC, pilot, and planned training jobs.
Separate modules or local processes do not imply separate machines. Product build,
installation, and validation must target the DGX's ARM64/GPU environment.

Site telemetry devices and operator browsers can communicate over the LAN. They
are external inputs/clients, not hosts for required product services. Installed
operation must work without internet or another compute server. Software/model
provisioning is an explicit installation/update step with locally staged artifacts
supported; it must not become a hidden runtime download or cloud fallback.

The installer owns reproducible provisioning and commissioning; the application
owns ongoing operation. Installation and lifecycle requirements are defined in
[deployment guidance](../deployment/dgx-spark/README.md). No installer or service
manager is implemented by this documentation.

## Ownership

| Location | Owns | Does not own |
|---|---|---|
| `apps/dashboard/` | Animated monitoring view, chat, forecast and simulation UI | Domain logic, direct model or equipment connections |
| `apps/api/` | Local API, application lifecycle, composition and dependency wiring | Physics, model training, CAD interpretation |
| `src/hvac_agent/core/` | Site/equipment identities, topology, units, common request/event contracts | Provider SDKs, UI, generic utility dumping ground |
| `src/hvac_agent/cad/` | CAD interpretation, topology extraction, 2D scenes, asset-generation workflow | Live rendering, simulation physics |
| `src/hvac_agent/agent/` | Agent harness, conversation/task state, tool orchestration and memory | Forecast internals, training, equipment protocols |
| `src/hvac_agent/simulation/` | Site model assembly, scenario execution, simulated state and actions | Physical equipment writes, operator UI |
| `src/hvac_agent/prediction/` | Forecast inference, historical-data preparation and per-site adaptation | Backbone LLM alignment |
| `src/hvac_agent/pilot/` | Monitoring, anomaly assessment, simulation correction policy and history | Physics engine, implicit real-equipment control |
| `src/hvac_agent/knowledge/` | Curated-source ingestion, retrieval, indexing and provenance | Agent conversation memory, raw telemetry storage |
| `src/hvac_agent/training/` | Backbone LLM fine-tuning, RLHF/RLAIF, feedback and domain evaluations | Runtime orchestration, forecast-specific adaptation |
| `src/hvac_agent/integrations/` | Telemetry/BMS, model/image serving, storage and modified PHYVAC adapter | Cross-module business logic |
| `configs/site/` | Sanitized examples for one site's configuration | Secrets or a directory of customer installations |
| `deployment/dgx-spark/` | Standalone lifecycle, packaging and platform guidance | Product domain logic |
| `scripts/` | Thin setup, maintenance and validation utilities | Reusable runtime capabilities |
| `tests/` | Checks and future behavioral/evaluation coverage | Customer data or trained artifacts |

## Dependency direction

- `core` is the lowest layer and does not import applications or feature modules.
- A feature module owns its public interface and depends on shared domain contracts.
  Cross-feature calls use public interfaces, not another module's internals.
- `agent` orchestrates telemetry, retrieval, forecasts, and simulation through tool
  interfaces. `pilot` consumes observations and requests simulation actions through
  explicit interfaces. Neither embeds the other modules' implementations.
- Provider adapters implement module-owned interfaces. `apps/api` wires these
  implementations into modules; domain code does not instantiate external clients.
- `apps/dashboard` consumes the local API. Future frontend/backend schemas should
  be derived from the API contract once the transport and frameworks are selected.
- Training produces versioned artifacts for runtime consumers; runtime modules do
  not depend on training jobs or a training framework being installed.

Interfaces and schemas are not implemented in this scaffold. As code is added,
place a contract in `core` only when it actually needs to be shared. Keep a module's
private types within that module and avoid circular imports.

## Data shared between modules

| Planned artifact | Producer | Consumers |
|---|---|---|
| Validated topology, equipment IDs, parameters and sensor mappings | CAD workflow + installation configuration | Dashboard, telemetry adapters, simulation, prediction, agent |
| 2D scene and sprite/animation asset manifest | CAD workflow + image-model adapter | Dashboard |
| Timestamped observations with units and quality | Telemetry adapters or simulation | Dashboard, agent, prediction, pilot |
| Scenario definition and simulation state/results | Simulation | Dashboard, agent, pilot, evaluations |
| Forecast with horizon, uncertainty and model/configuration provenance | Prediction | Dashboard, agent, pilot |
| Retrieved passages and source references | Knowledge | Agent, pilot |
| Anomaly, proposed/applied correction and outcome history | Pilot | Dashboard, agent, evaluations |
| Backbone model/adapters with training and evaluation metadata | Training | Local model-serving integration |

Real and simulated observations must identify their origin. Simulation actions
must identify their simulation run. A future real-equipment control interface is a
separate decision; do not reuse simulation actions as a physical write path.

## Installation, runtime and storage

Installation consumes CAD, equipment parameters, sensor mappings, site documents,
and historical telemetry when available. It produces one validated site
configuration, a scene and animation assets, a configured simulator, a retrieval
index, and an adapted forecast model or a configuration-based pretrained fallback.

Runtime loads those artifacts locally. Telemetry drives the monitoring view;
operators use the harness and request simulations; the pilot observes and corrects
running simulations. Expensive CAD/asset generation and model training are outside
the normal monitoring loop. Scheduling GPU and memory use on the DGX is a future
implementation decision.

Use ignored `var/` (or an installation-configured external path) for site inputs,
generated scenes, models, indexes, telemetry, simulation runs, and logs. Use ignored
`.local/` for private workstation notes and connection/configuration details.
`configs/site/` contains sanitized examples only. Do not introduce tenant IDs or a
multi-site registry; equipment and simulation-run IDs are still necessary.

## Consistency across the product

Maintain a versioned semantic site definition: equipment, physical connections,
parameters, sensor mappings, units, and evidence/validation status. Keep presentation
layout and generated artwork separate from physical topology. Both the 2D scene and
the PHYVAC configuration derive from the same validated site revision. A visual
rearrangement must not change physics; a topology/parameter change requires checking
the dependent simulation configuration, bindings, and prediction artifacts again.

Drawing extraction may identify an equipment roster without establishing the actual
connections. Mark missing or inferred information and resolve it during installation;
do not silently substitute a conventional plant topology for the customer's station.

Use explicit observation origin, units, sample time, simulation time/run ID, and
configuration revision across API responses and events. Keep dashboard presentation
commands separate from simulation control commands. Conversations and simulation
runs can have their own IDs without introducing multi-site support.

`simulation` owns the run state machine, scenarios, baseline controllers, and result
history. A future PHYVAC adapter in `integrations` translates domain configuration
and actions to the modified engine and returns normalized observations. The selected
fork's component coverage, units, dependencies, and numerical behavior must be checked
before defining its adapter contract; this scaffold does not assume an upstream API.

The simulation clock, pilot assessment cadence, and dashboard update cadence are
separate. Slow inference cannot stop stepping or telemetry. Pilot corrections are
validated against the active run, equipment limits, and observation freshness before
application. Record the proposed action, actual application, and measured outcome.

One DGX hosts all runtime capabilities. Plan resource budgets and job priorities for
chat, forecasting, pilot investigations, model serving, CAD image generation, and
training/adaptation. Retain lightweight monitoring when a model is unavailable, and
make degraded results visible. Process count and serving technologies remain open.

## Validation and future implementation

Run project checks on the designated DGX Spark with an isolated environment. The
existing smoke check only guards the scaffold layout. Add behavioral tests as
capabilities are implemented, organizing them under `tests/` by module; integration
and evaluation suites should cover shared contracts and measured model/simulation
quality when those capabilities exist. Do not report placeholder checks as
validation of forecasting, simulation fidelity, pilot safety, or model quality.
