# Product

<!-- impeccable:product-schema 1 -->

Scope: the dashboard in `apps/dashboard/`. The repository's root [PRODUCT.md](../../PRODUCT.md)
and [AGENTS.md](../../AGENTS.md) are the product authority; this record adds what
dashboard design work needs and defers to them on any conflict. Confirmed in the
init interview on 2026-10-04.

## Platform

web

## Users

**Primary: the shift operator.** Watches the plant through a shift, responds to issues
and asks the agent, often from a control-room desk or wall display. Their job: know the
plant's state at a glance, notice and investigate problems with evidence, anticipate
cooling demand, and test corrective actions in simulation.

The root PRODUCT.md also describes installation and commissioning work and engineering
use of forecasts and simulations. Who does that work has not been confirmed as a design
audience.

## Product Purpose

A maintenance and operations agent system for one data center's HVAC and cooling
plant. The dashboard is the operator's workspace: the site's animated plant is the
primary monitoring screen, alongside agent conversations, cooling forecasts, simulation
controls and results, and the AI pilot's monitoring and correction history. The agent
presents grounded charts, tables and equipment highlights in the same workspace, with
a clear path back to the plant.

## Positioning

Four claims define the product's intended identity:

1. **Fully local:** the whole product runs on one NVIDIA DGX Spark for one data center.
2. **The site's own plant:** the plant view is generated from the site's CAD at
   installation.
3. **Site-specific simulation with an AI pilot:** the pilot tests corrective actions in
   simulation only, never on physical equipment.
4. **An evidence-based agent:** it shows its tools, data sources, freshness and
   uncertainty.

As of 2026-10-04 these describe the intended product, not operational features. Design
work must keep existing functionality clearly distinct from planned capabilities and
never present an unfinished feature as operational.

## Operating Context

- One DGX Spark per data center hosts the dashboard, API, models, simulation and data.
  Operators use browsers on the site LAN; installed operation needs no internet
  connection or second server.
- Monitoring is continuous across shifts. Issues are tracked through detection,
  investigation, correction and resolution, not raised anew on every reading.
- Installation and commissioning come before operation: CAD analysis produces the
  scene and topology, then simulator configuration, then prediction adaptation (root
  PRODUCT.md §3).
- Today the dashboard is the Version A prototype ([VERSION_A.md](VERSION_A.md)): fixture
  data only, a demo clock with replay and live-demo modes, and a scenario picker. It
  has not been validated on the DGX Spark.

## Capabilities and Constraints

Nothing below is operational at a site. Status as of 2026-10-04.

**Built in the prototype, with synthetic data only:**

- Overview: animated plant, status band, issue line, equipment details, playback and
  an equipment list.
- Analytics: cooling demand forecast page using a labelled demo baseline, not a
  trained model.
- Engineering: equipment roster with filters.
- AI assistant: a scripted demonstration. It matches questions to prepared
  investigations and calls simulated tools over the synthetic data; no language model
  is connected.
- A right-hand workspace with Details, Assistant and Pilot. The Pilot tab is a planned
  state only.

**Planned, not built in the dashboard:**

- Live telemetry through the local API.
- A real agent harness with a local language model.
- The curated knowledge base (RAG).
- Running site simulations (modified PHYVAC) from the UI; the simulation foundation
  exists on a separate branch.
- The AI pilot.
- CAD Studio, installation and commissioning flows.
- A trained or site-adapted prediction model.
- The System and Installation screens.

**Constraints:**

- One site, one DGX, no fleet, tenant or cloud concepts.
- Physical equipment control is out of scope.
- Missing telemetry, stale data, unavailable tools and uncertainty are shown, never
  filled in.
- Equipment IDs stay stable across scene, telemetry, simulation and forecasts.
- Customer data, generated site assets and model weights stay out of Git.
- **Language:** English only.

**Terminology:**

- Cooling demand and delivery are thermal kW ("kWt"), distinct from electrical power
  (kW), COP and temperatures.
- Issues have IDs (`ISS-0142`) and a severity.
- Equipment IDs look like `chiller_plant_2`.
- Disclosure labels: "Demo data", "Scripted demo", "Simulated tool", "demo baseline".

**Undecided:**

- The product's dashboard framework (Version A uses React and Vite as a prototype).
- API transport and telemetry protocols.
- The agent implementation and local model.
- The forecast model and its accuracy targets.
- The PHYVAC fork.
- A required accessibility standard.
- Design audiences beyond the shift operator.

## Brand Commitments

- The name is HVAC Agent.
- The owner-approved M1 equipment artwork (`src/features/monitoring/scene/sprites/`:
  chiller, cooling tower, data hall, pump) and its style are preserved.
- Synthetic-data disclosures stay visible wherever synthetic data appears.
- The owner wants a professional industrial product with a distinctive HVAC Agent
  identity, not a generic dashboard (redesign approval, 2026-10-04).
- **Not binding:**
  - The NEXORA screenshot is inspiration only.
  - Nothing may be copied from the `openclaw-hvac` reference prototype (implementation,
    assets, configuration or prompts).

## Evidence on Hand

- **Synthetic demo plant** (`src/fixtures/demoPlant.ts`): 16 items. Four cooling
  towers, three chillers, four condenser-water pumps, four chilled-water pumps and a
  data hall.
- **Seven deterministic scenarios** (`src/fixtures/scenarios.ts`): normal operation,
  afternoon peak, cooling tower 4 fan fault, CHW pump 2 trip, missing and stale
  sensors, telemetry disconnected, scene revision mismatch.
- **Demo forecast baseline** (`src/fixtures/forecast.ts`): a seasonal profile, labelled
  as a baseline.
- **Scripted assistant** (`src/fixtures/agentScripts.ts`, `fixtureAgent.ts`): prepared
  investigations and three recorded demo conversations.
- **Acceptance criteria and test results:** [VERSION_A.md](VERSION_A.md).

**Absent; do not fabricate:**

- Customer CAD, telemetry or site data.
- Measured simulation fidelity.
- A trained forecast model or accuracy figures.
- Language-model capability claims.
- Customers, testimonials, benchmarks or deployment status.

Scores reported by the `openclaw-hvac` prototype are not evidence for this product.

## Product Principles

1. **Real, demo or planned: always say which.** Every screen, label and answer shows
   whether it is live site data, synthetic data, or a capability not built yet.
2. **Evidence before assertion.** Answers, diagnoses and forecasts show their sources,
   freshness and uncertainty; gaps are stated, not filled.
3. **Simulation is not control.** Corrective actions are tested in simulation; nothing
   in the product writes to physical equipment.
4. **One site, one machine.** Everything serves one data center from its own DGX
   Spark.
5. **The plant is the anchor.** The site's own plant is the primary screen, and every
   view leads back to the equipment it concerns.

## Accessibility & Inclusion

- No formal standard has been set (undecided).
- The preserved test suite requires:
  - no serious or critical axe violations on the screens it covers;
  - full keyboard operation;
  - focus moving to the page heading after navigation.
