# Cooling-load prediction UI and monitoring connection

**Assignment:** implement `/prediction` and the forecast summary embedded on `/`.
This is the exact frontend home for cooling-load prediction. Backend work belongs
in [src/hvac_agent/prediction](../../../../../src/hvac_agent/prediction/README.md),
transport in [API prediction routes](../../../../api/routes/prediction/README.md).
Read the [canonical draft contract](../../../../../docs/ui-data-contracts.md) and
[dashboard standards](../../../README.md). Status (2026-10-04): `ForecastDataController`,
`CoolingForecastSummary`, `PredictionPage` and `PredictionReadiness` exist in the Version A
fixture prototype, fed by a labeled seasonal-profile demo baseline (not a trained model).
No model or live API integration. Details: [VERSION_A.md](../../../VERSION_A.md).

**Owner change, 2026-10-15:** the `/prediction` page (the Prediction tab, formerly Analytics) is now a predicted-against-
actual chart. It opens empty with **Predict**; Predict requests the forecast as of the
playback clock and draws the predicted curve in. The plant is then played from the deck
(the same global clock the Overview runs on) and the actual cooling load is logged onto
the chart up to the clock, with the points logged and the error so far
(`predictionError.ts`). The prediction is kept across screens in `predictionStore.ts`; a
forecast link (`?forecast=`) opens that forecast instead. AI Pilot is started from the
workspace, not from this page. The provenance, earlier-forecast comparison and readiness
panels described below are no longer on the page; `PredictionReadiness` is kept for `/setup`.

## Own these components

| Component / controller | Placement and responsibility |
|---|---|
| `PredictionPage` | Full `/prediction` route: context, request controls, result, provenance and model readiness |
| `CoolingForecastSummary` | Imported by `features/monitoring/` beneath the main scene; peak/time/horizon/freshness and small chart |
| `ForecastChart` | History and forecast with forecast boundary, optional intervals and accessible table |
| `ForecastStatus` | Data/model readiness, freshness, partial results and actionable failure reasons |
| `PredictionReadiness` | Reused in `/setup` for history availability, model mode and adaptation job status |
| `ForecastDataController` | Shared result/cache/job state; used by the page and summary, never two independent models |

The component names are proposed. Export them through this feature's public entry
point when built. Keep generic chart rendering in shared components, not duplicated.

## Screen and semantics

The first target is **future site-wide cooling load in thermal kW** (`cooling_load_kw`).
It is demand, not electrical power, cooling delivered, temperature, or COP. Do not
invent equipment-level forecasts from the site total. A device inspector may link
here but must label the forecast as site-wide.

Place source/run and "Forecast based on data through …" above the plot. Controls
select only API-supported horizon and timestep; do not hard-code a 24-hour promise.
Show observed history to the left of a cutoff marker and future estimates to the
right. Use solid/dashed lines and labels, not color alone. Mark gaps. Show a prediction
interval only if the backend supplies its bounds and meaning; never invent a band.
Include a table with timestamps, values, units, quality and available bounds.

Below the chart show peak demand and time, input freshness, model mode/revision,
site configuration revision and warnings. Site-adapted, pretrained fallback and a
baseline must be distinguishable. "No model available" is not a zero-load forecast.
Available/rated capacity comparisons require a supplied, correctly scoped capacity
source; do not use a hard-coded threshold or imply guaranteed overload detection.

## Exact integration flow

1. Read prediction capabilities and readiness through the shared API client.
2. Get the latest result for the current source/run/configuration or let the operator
   request one. An explicit generation request starts/reuses a backend job; mounting
   a component must not train a model or generate duplicate forecasts.
3. Track the job until it returns a forecast ID. Retrieve and validate the result.
4. Cache by source, run, config revision, cutoff, target, horizon and timestep. Both
   page and monitoring summary consume that same result. The summary's "View forecast"
   link opens its exact forecast ID with matching context.
5. Reject late responses from old contexts. When the site revision or run changes,
   clear incompatible results; never display a previous site's/run's forecast as current.
6. Refresh display freshness without rerunning inference. For telemetry, evaluate
   freshness against observation/wall time; for simulation, against that run's
   simulated time. A paused run is not stale merely because wall time advances.

These operations map to the proposed endpoints in the API README. They are not
available yet; build fixture states behind the same interface until connected.

## States and model adaptation

Provide unconfigured, loading, ready, partial/gappy, stale input, disconnected,
unsupported horizon/source, unavailable model, failed job and permission-denied
states. Retain a last successful result only with its original time/source and a
clear stale/error label. Reuse shared progress/notice components.

During setup, `PredictionReadiness` explains whether usable site history exists,
whether a local pretrained artifact exists, and which mode can run. Adaptation is
an explicit background job triggered through the API, not training on page load.
Display validation/promotion status separately from job completion. If neither
history nor a compatible pretrained model is usable, show unavailable and next steps;
do not fabricate a pretrained fallback. Backbone RLHF/RLAIF is outside this UI.

## Acceptance and handoff

- Summary and detail show the same forecast ID, peak, horizon and units.
- Real/simulated context, midnight/timezone boundaries, missing points, no intervals,
  stale inputs and out-of-order responses render correctly.
- No model/insufficient history/failed adaptation have useful, honest states.
- A duplicate click cannot enqueue two uncontrolled jobs. Reads do not trigger training.
- Keyboard/zoom/narrow layouts and chart/table equivalence work; no customer data
  is committed. Validate the real path on DGX when implemented.
- Document implemented endpoints, supported model modes/horizons, commands and known
  gaps here. Update project context; do not label a fixture UI as integrated prediction.
