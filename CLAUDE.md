## Start here

Recover state from the repository, never from earlier chat history. Read
`apps/dashboard/M6_HANDOFF.md` (current state, requirements, recovery order), then
`apps/dashboard/DESIGN.md` (the approved Treatment A design) and
`apps/dashboard/VERSION_A.md` (milestones, owner decisions, evidence). Git and the
current files are authoritative; documents and the graph below can be stale.

- This checkout holds another engineer's uncommitted work: root and module docs,
  `PROJECT_CONTEXT.md`, the brief READMEs and `install.ps1` (stays untracked). Never edit,
  stage, revert or clean it.
- `PROJECT_CONTEXT.md` is frozen by the owner: read it as background, never modify it;
  propose a patch to the owner instead.
- No destructive Git. Stage, commit or push only when the owner asks. Start no milestone
  without the owner's explicit approval.
- Everything shown is synthetic or simulated and labelled so: the assistant is a scripted
  demo, its tools are simulated, and the AI pilot is simulation-only with no physical
  equipment actuation. Keep every provenance label.
- One dev server: check port 5173 before `npm run demo` in `apps/dashboard/`.

## graphify

This project's knowledge graph lives OUTSIDE the repository, at
`C:\Users\Crusher1\Documents\HVAC\graphify-hvac-agent\graphify-out\`
(code-only: `graph.json`, `.graphify_analysis.json`, `manifest.json`, `cache/`).
Graphify must never write inside this repository.

Rules:
- For codebase questions, first run
  `graphify query "<question>" --graph "C:\Users\Crusher1\Documents\HVAC\graphify-hvac-agent\graphify-out\graph.json"`.
  Use `graphify path "<A>" "<B>"` and `graphify explain "<concept>"` with the same `--graph` option.
- Treat the graph as architectural context, not the current state. It can be older than the
  working tree (compare its date with recent changes) and it does not model CSS. Git and the
  files are authoritative.
- Refresh only when the owner asks, with
  `graphify extract "C:\Users\Crusher1\Documents\HVAC\hvac-agent" --code-only --out "C:\Users\Crusher1\Documents\HVAC\graphify-hvac-agent"`
  (local AST, no API key; writes `graphify-out\` there). Record `git status` before and after.
- Never run `graphify update .`, `graphify watch`, `graphify hook install` or
  `graphify claude install`, or any extraction without `--out`: they write into the repository.
