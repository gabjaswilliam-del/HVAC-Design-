# Forecast evaluation and evidence

**Assignment:** establish what skill the [cooling-load predictor](../README.md)
actually has. No accuracy target or validated model exists yet.

Use chronological held-out and rolling-origin evaluation. At each cutoff, features
must include only information then available. Keep tuning separate from final test
windows; do not use future realized demand or weather from a simulation scenario
as prediction inputs. Label synthetic and measured-site evaluations separately.

Compare against persistence and seasonal-naive baselines where enough history
exists. Report MAE/RMSE in thermal kW by horizon, peak magnitude/timing error and
coverage of missing/quality-filtered data. Avoid undefined percentage metrics near
zero demand. If intervals are supplied, measure coverage and width on held-out data
and disclose calibration limits. Choose release thresholds from operational needs
with the project owner; do not invent an acceptable accuracy percentage.

Record target definition, source, windows, site/config revision, dataset fingerprint,
model/preprocessor/seed and feature assumptions. Measure DGX inference latency and
memory separately from statistical skill. Save reports/artifacts in ignored runtime
storage; retain sanitized test fixtures and code in Git.

Acceptance: an evaluation can be reproduced from versioned references, detects
leakage and misaligned predictions/actuals, and reports baseline comparisons by
horizon. Provide a promotion report to `adaptation/` and honest UI metadata; no
training score or prototype benchmark should appear as validated site accuracy.
Status: brief only. Add actual commands/results here and update project context.
