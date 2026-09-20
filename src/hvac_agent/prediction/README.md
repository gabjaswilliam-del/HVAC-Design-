# Cooling prediction

Forecast future cooling demand and behavior for the installed data center. Own the
forecast interface, inference, input preparation, site-specific adaptation, and
forecast evaluation. Expose horizon, uncertainty, and model/configuration provenance.

At installation, train/adapt on historical site data when usable history exists.
Otherwise use our pretrained model conditioned on the site configuration. Report
the limits of that fallback. Model family and accuracy targets are not selected.

Distinguish cooling demand, delivered cooling, and COP/efficiency targets. Use
chronological evaluation, simple baselines, horizon/context comparisons, and
reproducible experiment records. Results reported in the reference prototype are
not evidence for model selection or accuracy at this installation.

Keep backbone LLM fine-tuning and RLHF/RLAIF in `training/`. Agent, pilot, and API
consumers use the forecast interface, not model internals. This is a placeholder;
no pretrained model, inference path, or adaptation routine is supplied yet.
