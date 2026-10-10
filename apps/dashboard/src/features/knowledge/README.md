# Knowledge library and evidence reader

**Assignment:** implement `/knowledge` and a reusable cited-source reader. Read
the [dashboard handoff](../../../README.md). Retrieval/ingestion belongs to
[knowledge](../../../../../src/hvac_agent/knowledge/README.md); this folder owns UI only.

Show curated engineering references and site documents with title, source, revision,
ingestion/index status and last update. Keep these distinguishable from conversation
memory, telemetry and training data. Search should expose the retrieved excerpt and
source location, not just an unsupported generated answer.

Implement upload/import using supported local API formats/size limits, track parsing
and indexing as jobs, and show partial failure/retry. Import completion is not
equivalent to successful indexing. A citation from chat/pilot opens the exact document
revision and passage; unavailable/deleted sources produce an explicit warning.

Do not embed provider clients, retrieval logic or cloud document storage. No customer
documents in source fixtures. Render extracted content safely; do not execute scripts
from uploaded documents. Hide unsupported management actions with an explanation,
and let backend permissions determine editing/removal capability.

Acceptance: empty library, processing/failed index, no search matches, inaccessible
citation, long titles and keyboard source navigation. Update this README and project
context with actual supported formats/endpoints. Current status: brief only.
