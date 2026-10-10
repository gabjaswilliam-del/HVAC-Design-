# Prediction API routes — exact UI connection point

**Assignment:** place prediction transport handlers here. The directory is
framework-neutral; keep it as the ownership boundary when wiring the selected server.
No routes exist yet. Use the [canonical draft schema](../../../../docs/ui-data-contracts.md),
[prediction backend](../../../../src/hvac_agent/prediction/README.md) and
[forecast UI](../../../dashboard/src/features/prediction/README.md).

## Proposed HTTP interface

These paths are a concrete handoff proposal, not live endpoints. Agree changes with
the UI owner and update this README plus shared contracts together.

| Method / path | Responsibility |
|---|---|
| `GET /api/v1/prediction/capabilities` | Available models/modes, supported targets/sources/horizon-step combinations, input requirements, readiness and adaptation support |
| `GET /api/v1/prediction/forecasts/latest` | Latest compatible result for explicit source/run/config/target/horizon/step context, or no-result state; no inference side effect |
| `POST /api/v1/prediction/forecasts` | Validate forecast request and idempotency key, enqueue/reuse local inference, return `202` and job reference |
| `GET /api/v1/prediction/jobs/{job_id}` | Job state, progress when known, result ID or failure reason |
| `POST /api/v1/prediction/jobs/{job_id}/cancel` | Request supported cancellation and report actual resulting state |
| `GET /api/v1/prediction/forecasts/{forecast_id}` | Retrieve immutable forecast with model/input/config provenance |
| `POST /api/v1/prediction/adaptations` | Explicit commissioning adaptation job using registered local data/model references; return job reference |
| `GET /api/v1/prediction/readiness` | Usable history, compatible local artifacts, adaptation/evaluation/promotion state and blockers |

Serialize queries and bodies through the versioned shared schema. A telemetry
request cannot include a simulation run ID; simulation requests require one and
use its clock. Return a clear no-result response for `latest` when no compatible
forecast exists instead of running a model invisibly. Never accept arbitrary
filesystem/model paths from the browser. Enforce access to jobs/results as well as writes.

## Backend and frontend wiring

Inject the prediction module's public service into handlers at app composition.
Handlers validate/serialize/enqueue; `prediction/preparation`, `inference`, `adaptation`
and `evaluation` own the actual work. Keep future job persistence/scheduling local
to the DGX; a service manager or queue technology has not been selected.

The browser client belongs in `apps/dashboard/src/lib/api/`; its types belong in
`lib/contracts/`. `features/prediction/ForecastDataController` consumes results and
feeds both the prediction page and monitoring summary. Expose history through the
agreed time-series reader with the same target/context; do not relabel delivered
cooling as load history.

## Required failure and acceptance cases

Reject invalid horizon/grid/source/run/revision and unavailable required features.
Distinguish model unavailable, insufficient history, stale inputs, unsupported
source, failed inference, cancelled job and successful partial result. The UI must
not need to parse Python exception text. A pretrained artifact must actually exist
before readiness advertises that fallback.

Test duplicate requests, changed payload with reused idempotency key, navigation
during a job, cancellation races and result-context mismatch. Prove a generated
forecast travels through this API to both UI placements on DGX; include a no-model
case that renders unavailable. Record real commands, schema version and integration
evidence here and in project context. No model work belongs in route handlers.
