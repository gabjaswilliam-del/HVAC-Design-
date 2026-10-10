# Prediction input and target preparation

**Assignment:** implement input validation and feature/target preparation for
[cooling-load prediction](../README.md). No pipeline exists yet.

Define the engineering meaning and provenance of `cooling_load_kw` labels with the
data owner. Distinguish measured demand, inferred demand, delivered cooling and
synthetic scenario demand. Validate units, equipment/site revision, timezone,
sampling cadence, duplicates, gaps, outliers and sensor quality before use.

Access history through injected telemetry/simulation readers, not a remote database
or frontend state. Never mix actual telemetry and simulation data without explicit
dataset provenance and evaluation labeling. Keep raw customer history in runtime
storage; tests use small synthetic data.

Build causal features using only data available by `as_of`. Resampling, gap filling,
normalization and feature selection must not see future observations or validation/
test partitions. Fit preprocessors on training data only and persist their versions.
Future weather/load schedules require issuance provenance available at cutoff.

Output a validated input bundle with source/run, config revision, time bounds,
latest sample, quality/coverage, feature schema and preprocessing revision. Return
explicit insufficient/stale/unsupported inputs when requirements cannot be met.
Do not fill unknown demand with zeros or claim imputed values were measured.

Acceptance: tests for cutoff leakage, splits, unit conversion, resampling alignment,
duplicates/missing data, daylight/timezone boundaries and source mismatch. Explain
data requirements and transformation choices here when implemented; update context.
