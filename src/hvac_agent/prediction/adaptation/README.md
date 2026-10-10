# Installation-time forecast adaptation

**Assignment:** implement site forecast training/adaptation as an explicit local job
for [prediction](../README.md). This is not backbone LLM training or RLHF/RLAIF.

Use validated historical data and a documented initial model/recipe. Snapshot input
data references, site configuration and preprocessing versions. Check usable history
and label quality before starting; no history leads to the pretrained-readiness path,
not a fabricated successful training run. All compute/storage remains on the DGX.

Jobs need durable queued/running/failed/cancelled/completed state, checkpoints where
appropriate, measurable progress and bounded resource use. Resume safely without
overwriting the active model. UI page visits must not start adaptation.

Split data chronologically with the [evaluation](../evaluation/README.md) owner.
Fit transformations on training data, tune on validation and retain an untouched
test window. Evaluate the candidate against the current model and simple baselines,
including horizon skill, input compatibility and runtime/resource limits.

Keep candidate, evaluated and activated artifacts distinct. Define promotion gates
and atomic activation/rollback before deployment; job completion alone does not
activate a model. Preserve the prior usable artifact if training or validation fails.
Return job/validation/readiness summaries through the public interface for `/setup`
and `/prediction`, without exposing private dataset paths or secrets.

Acceptance: insufficient history, interrupted/resumed/cancelled job, failed
evaluation, promotion/configuration mismatch and rollback. Record recipe, data/model
revisions, metrics and DGX resource evidence. Status: brief only; update context
and real commands when implemented.
