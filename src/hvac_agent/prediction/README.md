# Cooling-load prediction — backend implementation handoff

**Assignment:** implement future cooling-load forecasts for the one installed data
center and expose them through a public module interface. **Status: instructions
only; no model, pretrained artifact, inference or adaptation implementation exists.**
Read [project context](../../../PROJECT_CONTEXT.md) and the
[canonical UI/API contract brief](../../../docs/ui-data-contracts.md).

## Target and ownership

The first target is **future site-wide cooling demand in thermal kW**, named
`cooling_load_kw`. Required demand, delivered cooling, electrical power, water
temperature and COP are different quantities. Record how demand labels are measured
or derived; capacity-limited cooling output must not silently become ground-truth
demand. Do not add equipment-level forecasts by dividing the site total.

| Folder | What the assigned engineer implements |
|---|---|
| [preparation/](preparation/README.md) | Input/target definitions, history validation, causal features and provenance |
| [inference/](inference/README.md) | Local artifact loading, capabilities, forecasts, uncertainty and readiness |
| [adaptation/](adaptation/README.md) | Installation-time site adaptation, resumable jobs and promotion checks |
| [evaluation/](evaluation/README.md) | Chronological backtests, baselines, metrics, interval checks and evidence |

At this package root, define the prediction-owned request/result/capability contracts
and public service boundary. Proposed operations are `capabilities`, `readiness`,
`forecast`, `get_result` and `adapt`; names are guidance, not existing methods.
Share types through `core` only if other modules genuinely need the domain contract;
do not move model internals there. Provider integrations stay behind adapters.

## Delivery behavior

With usable historical site data, adapt/train the site model during commissioning
and evaluate it before activation. Without usable history, use a compatible **local**
pretrained artifact conditioned on verified site configuration. No such artifact
ships in the repository today. If neither path is available, return an explicit
unavailable result. An evaluation/persistence baseline must be labeled `baseline`,
not disguised as pretrained or validated site prediction.

Choose model family, input features, lookback, supported horizons/timesteps and
resource needs from evidence; no family or accuracy threshold is prescribed here.
Use simple baselines before asserting a learned model helps. Keep inference and
site adaptation separate from backbone LLM fine-tuning/RLHF/RLAIF in `training/`.

Return estimates with units, source/run, input cutoff, sample grid, data quality,
model/config revision and supported uncertainty. Unsupported inputs/horizons must
be rejected explicitly. The same request on an immutable model/input snapshot must
be reproducible or document stochastic seeds/variation. Site data and weights stay
in ignored runtime storage, not this source folder.

## Exactly how it connects to the UI

1. This module reads data through injected local telemetry/simulation-history
   interfaces and loads compatible artifacts on the DGX. No UI imports here.
2. [apps/api/routes/prediction](../../../apps/api/routes/prediction/README.md) validates
   requests, schedules local jobs and serializes the public results.
3. The dashboard's shared API client passes a validated result to
   [features/prediction](../../../apps/dashboard/src/features/prediction/README.md).
4. That feature owns both `PredictionPage` at `/prediction` and
   `CoolingForecastSummary`, imported by monitoring below the primary scene.
5. The setup UI reuses `PredictionReadiness` for history/model availability and
   adaptation progress. A successful job is separate from evaluated model promotion.

All consumers see the same forecast identity and provenance. Agent/pilot consumers
use the public module/API interface too. Rendering a page or reading a result must
not launch training. Real/simulated inputs and their clocks never mix implicitly.

## Implementation and acceptance sequence

First agree target and contracts; implement input validation and an explicitly named
baseline for end-to-end integration; establish held-out evaluation; then add/select
the local pretrained/site-adapted artifact path with measured limits. UI engineers
may use deterministic fixtures while these dependencies are unavailable.

Check future-data leakage, missing/stale history, unit conversion, source/run and
configuration mismatch, unsupported horizon, unavailable model and partial output.
Evaluate forecast skill by horizon against persistence/seasonal baselines, and
measure runtime/memory on DGX. Record data/model versions, metrics and limitations.
No prototype leaderboard or simulation comparison establishes prediction quality.

Acceptance requires a local forecast through API → full page and monitoring summary,
honest no-model/no-history behavior, meaningful backtests and documented supported
capabilities. Distinguish fixture plumbing, baseline integration and intended-model
validation. Update this README, contracts, subfolder READMEs and project context
after implementation; add actual run/test commands only when they exist.
