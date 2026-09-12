# prediction

Cooling-load forecasting over a short horizon, so the operator knows what is coming before it
arrives — how many chillers to stage, when the morning ramp starts.

Time-series foundation models are the intended approach: with one plant and a short record,
zero-shot models are attractive because they need no per-plant training data
(`PRODUCT.md` §3.3, §5).

Exposed to the agent as a tool behind a defined interface. The interface is what `../agent`
depends on; keep it stable and keep the model behind it.
