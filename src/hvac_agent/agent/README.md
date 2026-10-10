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
