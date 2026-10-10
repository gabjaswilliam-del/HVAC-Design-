# Local API — UI integration handoff

**Assignment:** compose backend modules for the single DGX installation and serve
the dashboard's data/operations. **Status: no server, framework or endpoints yet.**
Read [architecture](../../docs/architecture.md), [UI briefs](../dashboard/README.md)
and [draft contracts](../../docs/ui-data-contracts.md). Select one transport/framework
with the integration owner and record actual setup commands here when implemented.

## Responsibilities

Load site configuration, wire public module interfaces to local adapters, manage
application lifecycle, expose validated requests/results and job/update state.
Reusable logic stays in `src/hvac_agent/`; handlers do not contain physics, forecast
features/model inference, CAD analysis, RAG pipelines or pilot decisions.

| UI consumer | Backend owner / API duty |
|---|---|
| Monitoring/equipment | Compose site catalog/scene bindings and telemetry or simulation observations; preserve identity, units, quality and time |
| CAD Studio/setup | CAD jobs, validation findings, draft vs activated revisions and local generated assets |
| Agent | Harness sessions, streamed tool/answer events, cancellation and evidence references |
| Simulation | Run lifecycle/history, supported scenario controls, validated corrections and outcomes |
| Prediction | Forecast capabilities/jobs/results and adaptation/readiness; [route brief](routes/prediction/README.md) |
| Pilot | Simulation issue lifecycle, evidence, correction/outcome references and capabilities |
| Knowledge | Document import/index/search/source references with permissions and revisions |
| System/setup | Local health, commissioning progress, installed artifacts and supported maintenance jobs |

These are intended capabilities, not implemented route claims. Define each wire
contract before wiring feature screens. Surface unavailable backends explicitly.
Static API fixtures may support a clearly labeled demo but cannot represent production
success. Do not claim all PR #2 objects are merge-ready HTTP contracts.

## Implementation requirements

- One configured site, no tenant/site routing registry. Validate source/run/revision
  on every applicable operation and separate telemetry reads from simulation writes.
- Enforce permissions, input limits, file validation and operation eligibility on
  the server. The UI is not an authorization boundary. No physical equipment writes
  are in scope. Establish authentication for LAN access with the project owner.
- Use bounded reads, documented pagination/event ordering and recoverable reconnect.
  Return meaningful error codes, avoid secret/log leakage and serve local assets safely.
- Long CAD, forecast, adaptation and installation operations return durable job state.
  Do not block API responsiveness or the simulation clock on model work.
- Define idempotency for writes; duplicate requests must not duplicate runs/jobs.
  Render request acceptance, execution and measured outcome separately.
- Bundle/serve the installed UI locally. No required cloud service, external database,
  CDN or second compute host. Development origins must be explicit configuration.

Acceptance: meaningful boundary tests, source isolation, invalid/stale inputs,
duplicate writes, failure/reconnect, local artifact serving and the forecast-to-UI
path on DGX. Update the route READMEs, actual commands and project context when built.
