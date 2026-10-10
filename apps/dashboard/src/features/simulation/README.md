# Simulation workspace

**Assignment:** implement `/simulation` for the modified PHYVAC backend. Read the
[dashboard handoff](../../../README.md), [module boundary](../../../../../src/hvac_agent/simulation/README.md)
and current PR #2 review state before integration. Status: UI brief only.

Build `SimulationPage`, `ScenarioForm`, `RunControls`, `SimulationTimeline`,
`ResultsView` and `CorrectionHistory`. Use the monitoring scene renderer for a run
view rather than creating another equipment catalog. Keep a persistent Simulation
label, run identity, config revision and simulated time.

## Workflow and controls

- Select/configure a scenario using backend-supported inputs, units, duration and
  timestep. Display supported topology and known calibration/model limits.
- Start a new run and show backend lifecycle state. Step/play/pause/stop enablement
  comes from that state/capabilities. Repeated clicks cannot create duplicate runs.
- Observe results without advancing the clock. Pause is a backend operation, not
  pausing browser animation. Refresh/navigation must reconnect to the same run.
- For a simulation correction, show equipment ID, metric, requested value, units,
  allowed range and target run. Distinguish held manual overrides from baseline
  control and offer explicit release only when the backend supports it.
- Display proposed, queued, rejected, superseded, expired, applied and measured
  outcomes. A successful submission is not a successful correction.
- Plot demand, removed cooling, unmet demand, power and energy as distinct metrics.
  Compare baseline/pilot only for matched scenarios and clearly labeled revisions.

## Prediction connection

Import the prediction feature's forecast panel using `source=simulation` and this
run ID/cutoff. Hide or explain unsupported forecasting sources using capabilities.
Do not relabel a live forecast as a simulated one. Using a forecast as future scenario
load is a separate explicit action with provenance, only if supported by the backend;
no automatic feedback loop or future-data leakage.

## Acceptance

Exercise created/running/paused/stopped/failed runs, solver/envelope failure, invalid
setpoints, delayed/rejected actions, held/released overrides and reconnect after
navigation. Failure displays the last valid observation as retained data, not a new
successful frame. There are no real equipment controls. Record exact backend revision
and fixture/live integration coverage in this README and project context.
