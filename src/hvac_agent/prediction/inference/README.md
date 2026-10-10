# Local forecast inference

**Assignment:** implement artifact loading and forecast production behind the
[prediction public interface](../README.md). No model is selected or supplied yet.

Use versioned local artifacts with a manifest defining model/preprocessor versions,
target/units, feature schema, lookback, horizon/step capabilities, compatible site
configuration and evaluation/provenance. A service should not download a model
silently or require a cloud endpoint at runtime.

Choose a compatible activated site model or explicit pretrained fallback; expose
which mode was selected and why. A registered baseline is separate. If none is
usable, return unavailable with a reason. Never invent a forecast to satisfy a chart.
Validate the input bundle from `preparation/` and return the versioned forecast result in
the [shared contract](../../../../docs/ui-data-contracts.md).

Keep demand units and time grid exact; report partial samples and uncertainty
honestly. Prediction intervals require a documented method and calibration evidence.
Do not silently clip invalid results or suppress input-quality warnings. Record
model/input/config identity, wall generation time and source-clock cutoff.

Budget load/inference memory and latency on the DGX. Cache by immutable inputs and
model revision where appropriate, invalidate active selection on promotion, and
avoid loading a second full model per browser request. Do not block the simulation
clock on inference. Keep inference separate from training and API job transport.

Acceptance: deterministic/reproducible inference as documented, absent/incompatible
artifact, unsupported horizon, malformed model output, stale inputs, model update
and CPU/GPU availability failures. Record actual supported modes and DGX timings
without claiming site accuracy from runtime success. Update README/context.
