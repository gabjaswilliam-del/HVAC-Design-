# UI and cooling-load prediction integration brief

**Status: proposed contracts for implementation handoff, 2026-10-01.** No API
endpoints or frontend schemas are implemented by this document. Backend/API and UI
owners should agree these shapes together, then implement one canonical versioned
wire schema and update this brief. Do not treat existing Python objects on PR #2
as an already published HTTP API.

**Revised 2026-10-11:** added the optional request field `requested_mode`. The result
could already carry an explicitly selected `baseline`, but no request field could
select one. The forecast request and result shapes are being implemented as
`src/hvac_agent/prediction/contracts.py` on the `feat/prediction` branch, not yet merged;
that module and this brief change together.

## Ownership and data path

```text
Local telemetry or selected simulation history + validated site configuration
  -> src/hvac_agent/prediction/preparation/ validated model inputs and demand labels
  -> src/hvac_agent/prediction/inference/   local model -> forecast result
  -> apps/api/routes/prediction/           wire response / asynchronous job
  -> apps/dashboard/src/lib/api/          validated client response
  -> apps/dashboard/src/features/prediction/ ForecastDataController
       -> PredictionPage on /prediction
       -> CoolingForecastSummary imported by features/monitoring/ on /
```

Site adaptation lives in `prediction/adaptation/`; evaluation in
`prediction/evaluation/`. API handlers do not train/infer inline and charts do not
calculate substitute forecasts. One product, one configured site; no tenant/site
selector or multi-site API registry is implied.

## Shared operating context

Every applicable request/result carries source kind (`telemetry` or `simulation`),
site configuration revision, relevant equipment IDs and time bounds. Simulation
context also requires `run_id`. Reject a run ID on a telemetry request instead of
silently ignoring it. Fixture/demo is a separate explicit client mode, not a third
real telemetry source. Always label synthetic data in the UI.

Times on the wire are timezone-aware UTC ISO 8601. Keep observation/simulation time,
input cutoff and wall-clock generation/receipt time distinct. UI displays the
configured site timezone and explicit timezone labels where ambiguity matters.
For simulated data, wall time advancing while a run is paused does not make inputs
stale; use run time and backend quality policy. For telemetry, use sample time and
wall time. Clock skew/future samples are data-quality issues, not fresh readings.

Required common concepts (proposed wire contracts):

| Concept | Minimum information |
|---|---|
| Reading | Equipment/metric identity, value or null, unit, sample time, origin, quality/reason, config revision, run ID for simulation |
| Scene manifest | Scene/revision, matching physical config revision, equipment bindings, presentation coordinates and local asset references |
| Equipment | Stable ID, human label, family, known connections, parameter/evidence summaries and available metrics |
| Run status | Run ID, lifecycle, simulated time, scenario/config revision, permitted operations, last valid observation and failure details |
| Correction | Proposal identity/evidence time, target run/equipment/metric, request, queue/application state, actual step and measured outcome |
| Issue | Stable issue ID, equipment/context, severity/status, evidence references, investigation and outcome history |
| Job | Job ID, kind, queued/running/succeeded/failed/cancelled state, timestamps, progress only when measurable, result reference or error |
| Error | Stable code, operator-readable message, retryability, relevant field errors and request correlation; no secrets/tracebacks in UI payloads |

Schema versions, sequence IDs and config/run checks must make old responses and
reconnection gaps detectable. Preserve quality and nulls. Never convert a missing
reading to zero or let an old response replace data for a newly selected run.

## Forecast target and input meaning

The initial target is `cooling_load_kw`: **future required site-wide cooling load
in thermal kW**. Scope is the installed site's modeled cooling plant, not individual
equipment, electrical kW, delivered cooling, water temperature, or COP.

Measured demand labels need an agreed engineering definition. Flow × temperature
difference may estimate delivered cooling; under capacity shortage it does not
automatically measure required demand. Record the target's measurement/derivation
and quality; do not silently use output/capacity/COP as demand. A simulated scenario's
demand may be a synthetic training/evaluation label but is not measured site truth.

Inputs may include approved demand history, operating measurements, site parameters,
calendar features and available load/weather context. Exact required features and
lookback belong to the model manifest/capabilities. Every feature must be available
at the forecast cutoff. Future measured weather, future realized demand and hidden
future scenario values are not admissible inputs to an evaluated forecast. A known
schedule or weather forecast is permitted only with its own issuance provenance.

## Proposed forecast request

| Field | Meaning / validation |
|---|---|
| `schema_version` | `1` for this proposed schema; negotiate changes explicitly |
| `source` | `{kind: telemetry}` or `{kind: simulation, run_id: ...}` |
| `config_revision` | Revision matching source and model compatibility |
| `target` | `cooling_load_kw` for first implementation |
| `as_of` | Data cutoff on the source clock; all usable input must be at/before it |
| `horizon_minutes` | Positive API-supported horizon |
| `step_minutes` | Positive API-supported output interval; divides horizon |
| `requested_mode` | Optional. Absent: automatic selection, site-adapted then pretrained, never `baseline`. Present: a mode that capability discovery advertises as explicitly requestable; otherwise the request is rejected, not silently ignored |

Do not accept arbitrary model paths, provider URLs, site IDs or credentials from
the browser. Capability discovery advertises supported source/target/horizon/step
combinations, which modes may be requested explicitly, local model readiness, input
requirements and adaptation availability.
Examples such as six hours are illustrations, not an accuracy or availability promise.

## Proposed forecast result

| Field | Meaning |
|---|---|
| `schema_version`, `forecast_id` | Versioned response and immutable result identity |
| `status` | `ready`, `partial` or `unavailable`; a job failure is reported separately |
| `source`, `config_revision`, `target`, `requested_mode` | Echo validated context; do not infer it in the UI |
| `unit` | `kW` thermal; target labeling makes this distinguishable from electrical power |
| `as_of`, `generated_at` | Input cutoff on source clock; generation timestamp on wall clock |
| `input_window`, `latest_input_at` | History bounds and freshest usable sample |
| `horizon_minutes`, `step_minutes` | Requested/supported output grid |
| `model` | Artifact ID/revision and `site_adapted`, `pretrained` or `baseline` mode; `baseline` only when `requested_mode` is `baseline`; null when unavailable |
| `quality` | Freshness/coverage status, reason codes and applicable stale-after policy; no invented percentage of confidence |
| `series` | Ordered `{timestamp, value_kw, lower_kw, upper_kw, quality}` samples; bounds optional, missing values null |
| `interval` | Optional prediction-interval metadata: coverage, method and calibration status; absent when unavailable |
| `summary` | Optional backend-derived peak value/time over valid samples; identifies partial coverage |
| `warnings`, `reason_code` | Human-readable limitations and stable unavailable/partial reason |

Output timestamps are strictly increasing on the grid from `as_of + step_minutes`
through `as_of + horizon_minutes`. Do not include a nowcast at `as_of` as a future
prediction. Full results contain horizon/step points. Partial results preserve
the grid with null/quality-marked gaps; unavailable results contain no invented
series. Numeric values must be finite. Nonphysical negative load is handled by
an explicitly documented backend model/validation rule, never hidden by UI clipping.

Intervals must be ordered and compatible with their documented statistical meaning.
Do not describe an uncalibrated model spread as a guaranteed 90% prediction interval.
Observed history is a separately labeled series for the same target and context;
future actuals are absent until measured. Backtests retain historical forecast
issuance/cutoff and align actuals by time rather than overwriting predictions.

For unavailable model/history/source, return an explicit reason such as
`MODEL_UNAVAILABLE`, `INSUFFICIENT_HISTORY`, `INPUT_STALE`, `CONFIG_MISMATCH`, or
`SOURCE_UNSUPPORTED`. If neither site history nor a compatible pretrained artifact
is usable, the answer is unavailable; automatic selection never falls back to a
baseline. A persistence or seasonal-naive baseline may be advertised as an explicitly
requestable mode; it must never masquerade as our pretrained model. A request for a
mode that is not advertised is rejected as an invalid request. An advertised mode
that cannot run in this context, such as a baseline without enough history, returns
an unavailable result with its reason.

## Job and client behavior

Generation/adaptation may take time: return a job reference promptly, retain its
state on the DGX, and let clients observe progress without holding the UI open.
On completion, provide a forecast/artifact reference. Cancellation is best effort
and confirmed by backend state. Adaptation success is not model promotion; evaluation
and compatibility gates are separate.

The API's accepted operation must define idempotency (for example an idempotency
key): repeated delivery of the same key/request returns the same job; key reuse with
a different payload fails. Clients do not blindly retry ambiguous writes.

Forecast cache identity includes input cutoff, source/run, config revision, target,
horizon, step, requested mode and model revision. Invalidate current-result selection after model
promotion/config changes; retain historical results under their own identities.
Responses for obsolete context are discarded. Reading a forecast must not step the
simulator, invoke training or silently create another inference job.

## Other UI/backend boundaries

The API owner must define similarly explicit operations for scene/equipment reads,
telemetry updates, CAD jobs/revision changes, agent conversations/tool events,
simulation lifecycle/corrections, pilot issues, document ingestion and commissioning
health/jobs. These are logical capabilities, not existing endpoints. Feature READMEs
specify consumers and expected states; agree wire contracts before integration.

## Integration acceptance

Use a deterministic synthetic demand history and a small local baseline/model to
exercise backend → API → shared client → summary/page. Label a baseline explicitly.
Check horizon/time alignment, units, missing data, stale clocks, model/config
mismatch, job failure/idempotency and a delayed response after switching runs.
Both UI placements must show the same result. Repeat with an actual local artifact
before claiming model integration. Test installed operation without internet.
Document whether validation covers fixtures, a baseline, the intended model, or
measured site fidelity; they are separate claims.
