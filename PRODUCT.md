# HVAC Agent System — Product Description

**Status:** planned product; repository scaffold only · **Updated:** 2026-09-20
· Chinese mirror: [PRODUCT-zh.md](PRODUCT-zh.md)

## 1. Product and deployment

A maintenance and operations agent system for a data center and its HVAC/cooling
plant. An integrated dashboard and conversational agent harness help an operator
understand the installation, investigate problems, forecast cooling needs, and run
simulations configured to represent the site's pump station and cooling equipment.

Each installation runs standalone on **one NVIDIA DGX Spark for one data center**.
There is no multi-data-center, fleet, or multi-tenant product. A single data center
can contain many pumps, chillers, loops, rooms, and sensors; those are equipment
within one site, not separate tenants. The deployed runtime should operate locally;
provider choices and installation-time asset generation remain design decisions.

## 2. Product components

### 2.1 CAD Studio and installation

Accept a customer's CAD file, use AI to analyze it, and produce both a 2D design
scene and a machine-readable equipment topology. Image-model integration generates
sprites and animation assets during installation. The dashboard uses the resulting
animated scene as its main monitoring screen.

Topology and equipment configuration also feed the simulator and forecasting model.
CAD geometry alone cannot supply every operating parameter: installation must
capture and validate missing equipment specifications, sensor mappings, operating
limits, and other inputs needed to represent the actual pump station. Retain shared
equipment identifiers across the visual scene, telemetry, simulation, and forecasts.

### 2.2 Integrated dashboard and API

The first screen shows the animated site view with operating state and telemetry.
The dashboard also provides agent conversations, cooling forecasts, simulation
controls and results, and AI pilot monitoring and correction history. A local API
composes the backend capabilities for the dashboard.

### 2.3 Conversational agent harness

A tool-using agent system, in the style of OpenClaw, Codex, or Claude Code, answers
questions about the data center and its HVAC equipment. The harness manages the
conversation, tool execution, task state, and agent memory. It can query site data,
retrieve domain knowledge, request forecasts, and operate simulation workflows.
Those products are references for interaction and capability, not chosen dependencies.

### 2.4 Site-configured simulation

Simulation is a **shipped product capability**, available whenever an operator wants
to run a scenario. Configure it from the CAD-derived topology and verified equipment
parameters to model the specific station. The target is a faithful representation
of that station; fidelity and calibration must be measured rather than assumed.

Keep simulated state and actions distinct from real telemetry and equipment. PHYVAC
is a candidate engine, not an established dependency. The simulator also supports
development and evaluation.

### 2.5 Cooling prediction

A separate predictive model forecasts future cooling demand and behavior. During
installation, train or adapt it on historical site data when usable data exists.
Without that history, start from our pretrained model conditioned on the site's
configuration. Report uncertainty and limitations, particularly before site-specific
validation is available. The model family, horizon, and accuracy targets remain open.

### 2.6 AI pilot

An HVAC-informed pilot monitors operating state in real time. While a simulation
is running, it detects anomalies, applies corrective actions within the simulation,
and records the observations, reasoning, actions, and outcomes for the operator.

Autonomous correction of **physical equipment** is not defined by this scope. Any
future real-equipment write path requires a separate control design, authorization,
and operating limits; simulation corrections do not imply that capability.

### 2.7 Domain LLM and training

Build a data-center-specialized backbone LLM through domain fine-tuning and
reinforcement learning from human feedback (RLHF), followed later by reinforcement
learning from AI feedback (RLAIF). Specialization is a development objective, not an
existing capability or a claim established by this scaffold. Evaluate domain
performance before making model capability claims.

Backbone LLM training is separate from the installation-time adaptation of the
cooling prediction model. Training recipes, feedback collection, evaluation, and
artifact provenance belong in the training workstream. Model size, training location,
and DGX resource scheduling need to be determined; standalone operation does not
mean every foundation-model training job must run on the installed device.

### 2.8 Curated knowledge base and RAG

Build and maintain our own data-center/HVAC knowledge base. Ingest and retrieve
curated domain material and site documentation with source provenance so the agent
and pilot can ground their responses. Keep retrieval knowledge, conversational
memory, telemetry history, and model training datasets as distinct responsibilities.

## 3. Installation and operation

```text
Installation
  CAD + equipment specifications + sensor mappings
    -> validated site topology/configuration
    -> 2D scene + generated sprites/animation assets
    -> simulator configuration
    -> prediction adaptation if history exists; pretrained fallback otherwise
  Curated domain material + site documentation -> local retrieval knowledge

Operation on one DGX Spark
  Telemetry -> API -> animated dashboard
  Operator -> agent harness -> knowledge / telemetry / forecasts / simulation
  Simulation state -> AI pilot -> simulation corrections -> updated simulation state
  Forecasts + simulation results + pilot events -> API -> dashboard
```

## 4. Constraints and boundaries

- One installation, one data center, one standalone DGX Spark; no multi-site support.
- Dashboard, harness, simulation, prediction, pilot, CAD, knowledge, and training
  have explicit module boundaries; separate modules need not be separate services.
- Core domain contracts keep site/equipment identities and data units consistent.
- Expose missing tools, stale data, uncertainty, and model limitations rather than
  inventing results.
- Keep simulation actions and physical equipment integration separate.
- Store customer data, generated site artifacts, credentials, indexes, and weights
  outside Git. Track source, documentation, and sanitized examples.
- Use the designated DGX Spark account `ghani` for project testing. Connection
  details and passwords do not belong in tracked documentation.

## 5. Current work and open decisions

This change establishes the folder structure and product context only. None of the
components above is implemented. The architecture is documented in
[docs/architecture.md](docs/architecture.md).

Open choices include the dashboard framework, API transport, agent implementation,
local LLM and image-model serving, simulator engine, forecast model, storage and
retrieval backends, supported CAD formats, telemetry protocols, deployment packaging,
resource budgets, and evaluation criteria. Detailed physical-control behavior is
also outside the current definition. Do not select these technologies just to fill
the scaffold.
