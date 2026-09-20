# Backbone LLM training and alignment

Develop our data-center-specialized backbone LLM through domain fine-tuning and
RLHF, followed later by RLAIF. Own feedback preparation, training recipes,
domain evaluations, and model artifact provenance. Treat specialization and
capability claims as goals that require measured evidence.

Site-specific cooling predictor adaptation belongs in `prediction/`. Retrieval
ingestion belongs in `knowledge/`. Runtime modules load versioned model artifacts
through serving adapters; they do not import training jobs. Simulator-derived data,
base models, training infrastructure, and compute requirements remain open choices.

Placeholder only. Training datasets, feedback containing private information,
checkpoints, and weights stay outside Git.
