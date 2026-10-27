# Conversational agent harness

The natural-language entry point for questions and tasks about the data center.
Own the tool-using loop, conversation and task state, agent memory, and response
assembly. Expose telemetry, knowledge retrieval, prediction, and simulation through
tools that call those modules' public interfaces.

OpenClaw, Codex, and Claude Code are capability references, not chosen frameworks.
Keep LLM provider calls behind adapters, domain model training in `training/`, and
retrieval in `knowledge/`. Report unavailable tools, missing data, and uncertainty.
Simulation actions and physical equipment control are distinct scopes.

Placeholder only; no harness, tools, provider, or memory store is implemented.

UI assignment: [conversation and contextual assistant](../../../apps/dashboard/src/features/agent/README.md).
Expose tool/answer progress, typed data presentations, citations and cancellation
through the local API. The browser renders these; model execution and conversation
memory stay here or behind adapters. Reuse prediction/simulation public interfaces.

**AI display (2026-10-15).** What the assistant retrieves is shown on the Overview's AI
display, not by moving the operator to another screen. The harness should offer it as an
MCP tool, `show_on_display`, whose name, description and JSON input schema are defined in
[the dashboard's display contract](../../../apps/dashboard/src/lib/contracts/display.ts)
(line and bar charts, tables, figures, base64 images, and self-contained HTML that the
dashboard runs sandboxed). Each call is streamed to the browser as a `display` event. The
dashboard's demo assistant already calls it; the harness and MCP server are not built.
