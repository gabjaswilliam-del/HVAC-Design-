# agent

The agent loop: a natural-language question in, an answer plus a recommendation out.

The loop decides which tools to call, calls them, and composes the answer. Tools include
forecasting (`../prediction`), direct data queries, and diagnostic checks.

Two constraints from `PRODUCT.md` §3.2 and §5 apply to everything here:

- **Advisory, never autonomous.** There is no write path to the plant. The agent recommends;
  a human decides and acts.
- **Degrade gracefully.** If a tool is unavailable or a forecast is unreliable, say so rather
  than guessing.

An agent-runtime harness and an agent-memory system are optional infrastructure — the loop
must work without them. Which framework (if any), and which LLM provider, are open decisions
(`PRODUCT.md` §7).
