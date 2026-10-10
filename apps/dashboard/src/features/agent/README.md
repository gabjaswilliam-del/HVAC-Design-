# Agent conversation and contextual assistant

**Assignment:** implement `/agent` and a reusable conversation drawer for monitoring
and equipment. Use the [dashboard conventions](../../../README.md). Status (2026-10-04): Version A
**scripted demonstration** implemented (`AgentPage`, `AssistantDrawer`, `ConversationView`,
typed tool/view rendering) against a fixture harness; no language model or live API.
Contract and replacement path: [VERSION_A.md](../../../VERSION_A.md).

Build `AgentPage`, `ConversationPanel`, `MessageComposer`, `ToolActivity`,
`EvidenceReferences` and typed `DataView` rendering. Display the active device,
time range, source/run and site revision beside a contextual question. Starting a
new question must not silently reuse an incompatible simulation context.

Show streamed answer text, tool requests/progress/results, citations and partial
failures. Cancel calls the backend cancellation operation; display its confirmed
state rather than treating a hidden spinner as cancellation. Missing model, disabled
tool and disconnected service states must be visible and preserve the draft message.

Render charts/tables/highlights only from supported typed presentation payloads with
provenance. No arbitrary executable HTML or scripts from model output. A device
reference opens the shared inspector; a forecast reference opens the prediction
page for that forecast; a simulation action uses the simulation command workflow.
Presentations are not permission to change simulation or real equipment state.

The browser calls the local harness API. Conversation memory, tool execution, RAG
and model inference live in backend modules. No provider SDK/keys in this folder.
Use the shared chart/table components and citation viewer, not a separate dashboard.

Acceptance: streaming cancellation, a failed tool alongside useful evidence, citation
navigation, a very long answer, malformed presentation payload and reconnection.
Focus remains usable during streaming; screen-reader announcements are throttled
instead of repeating every token. Update this README and project context after work.
