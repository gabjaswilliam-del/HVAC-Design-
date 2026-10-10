# Curated knowledge and RAG

Our data-center/HVAC knowledge base: source curation, ingestion, document processing,
indexing, retrieval, and source provenance. Include site manuals and operating
procedures during installation; expose retrieval to the agent and pilot.

Keep conversation memory in `agent/`, raw telemetry access behind integrations, and
LLM training datasets in the training workflow. Retrieval backends and embedding
model clients are adapters, not fixed dependencies of domain logic.

Placeholder only. Customer documents and generated indexes stay outside Git.

UI assignment: [knowledge library and evidence reader](../../../apps/dashboard/src/features/knowledge/README.md).
Expose ingestion/index readiness and revision-specific source references through
the local API. Citation rendering belongs in the dashboard; retrieval/embedding
and document processing do not. Keep imported site documents separate from fixtures.
