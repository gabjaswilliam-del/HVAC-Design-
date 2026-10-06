# M6 handoff: HVAC Agent dashboard

**State recorded:** 2026-10-06 (Asia/Shanghai), at the end of the Version A, Treatment A
and Assistant-refinement work. **Next milestone:** M6, Simulation and AI Pilot. **M6
has not started** and starts only after the owner approves a fresh session's recovered
understanding and M6 plan.

This is a current-state handoff, not a history. Git and the current files are
authoritative: verify every statement here against them before relying on it, and say
so when they disagree.

## 1. Repository and safety state

| Item | State on 2026-10-06 |
|---|---|
| Repository | `C:\Users\Crusher1\Documents\HVAC\hvac-agent` (origin `github.com/yxiao986/hvac-agent`) |
| Branch | `feat/dashboard-version-a`, local only, no upstream configured (never pushed, no PR) |
| HEAD | The local checkpoint commit after `709e642`: feat(dashboard): Treatment A (Graphite) redesign and Assistant refinement, 2026-10-06 |
| Commits on the branch | `origin/main` `85093f8` plus six local commits: `4376230` M0–M1, `b7c525f` M2–M3, `90abc0a` M3.1, `bb234a4` M4, `709e642` M5, then the Treatment A and Assistant checkpoint |
| Staged | Nothing |
| Uncommitted | Only files outside the checkpoint: `CLAUDE.md` (kept local), tooling artifacts and the other engineer's work |

**The checkpoint commit** (2026-10-06, local, not pushed) holds the work after M5:

- 59 tracked files under `apps/dashboard/` are modified, 7 of them deleted. The
  deleted files are `PlaybackBar`, `PageHeading`, `AssistantDrawer`, `useConversation`,
  `EquipmentPage`, `KpiStrip` and `RecentIssues`.
- About 30 dashboard files were added:
  - the workspace (`src/app/workspace/`);
  - `TopBar`, `Dock` and `Deck`;
  - the Engineering hub and equipment records;
  - `AssistantPanel`, `conversationSession`, `Prose`;
  - new specs;
  - `DESIGN.md`, `PRODUCT.md` and this file.

Stage, commit or push only on the owner's explicit request.

**Another engineer's uncommitted work shares this checkout. Never edit, stage, revert or
clean it:**

- modified root and module docs: `AGENTS.md`, `PRODUCT.md`, `PRODUCT-zh.md`,
  `README.md`, `apps/api/README.md`, `deployment/dgx-spark/README.md`,
  `docs/architecture.md`, `tests/README.md`, `src/hvac_agent/*/README.md`;
- untracked: `PROJECT_CONTEXT.md`, `docs/ui-data-contracts.md`, `apps/api/routes/`,
  `src/hvac_agent/prediction/{adaptation,evaluation,inference,preparation}/`, and
  `install.ps1`, which must stay untracked and unmodified;
- the brief READMEs under `apps/dashboard/` (`README.md` and every `src/**/README.md`;
  17 are untracked). Their requirements are authoritative; their status lines are stale
  (see section 2).

**Tooling artifacts:**

- `.claude/settings.json` (untracked, created 2026-10-05) registers Graphify
  `hook-guard` PreToolUse hooks. This conflicts with the rule that Graphify has no hooks
  or integration here; the owner has not confirmed whether it is intended.
- `.claude/skills/ui-ux-pro-max/` is an untracked project skill.
- `.playwright-mcp/` holds two console logs from Claude's browser checks. It is safe to
  delete with the owner's agreement.
- `apps/dashboard/dist/` and `test-results/` are git-ignored.

**Standing rules:**

- No destructive Git (reset, clean, checkout of others' files, force anything).
- Never modify `PROJECT_CONTEXT.md`.
- Never put credentials in tracked files.
- Install nothing without approval.
- Run one dev server only: check port 5173 before `npm run demo`, because a second
  start breaks the running one.
- No milestone starts without the owner's explicit approval.

## 2. Which documents are current

| Source | Purpose | Status |
|---|---|---|
| `CLAUDE.md` (root, untracked) | Durable instructions for Claude Code: where to start, safety rules, Graphify rules | Current. Created by Claude at the owner's request; the start-here section was added 2026-10-06 |
| `apps/dashboard/M6_HANDOFF.md` | This file: current state, requirements and next steps | Current as of 2026-10-06 |
| `apps/dashboard/DESIGN.md` | The approved Treatment A design system (visual language, layout, components) | Current; matches the code |
| `apps/dashboard/VERSION_A.md` | Milestone log, owner decisions (F10), acceptance evidence | Current. Chronological: later sections supersede earlier ones (M5's "drawer" became the Treatment A workspace) |
| `apps/dashboard/PRODUCT.md` | Users, tone and design principles for UI work | Current (2026-10-04) |
| `apps/dashboard/src/features/simulation/README.md`, `features/pilot/README.md` | M6 requirements and acceptance (briefs, another engineer) | Requirements authoritative; "Status: brief only" is still true |
| `apps/dashboard/README.md` and other feature briefs | Assignment requirements per surface | Requirements valid; status lines stale (they name the drawer, `KpiStrip`, `RecentIssues`, `AssistantDrawer`) |
| `AGENTS.md` | Repository working agreements (another engineer) | Durable rules valid. Its "update `PROJECT_CONTEXT.md` after substantive work" is overridden by the owner's freeze: propose patches instead |
| `PROJECT_CONTEXT.md` | Portable LLM context prompt for the whole product | **Stale for the dashboard since 2026-10-04 14:18.** Claude maintained it under its own protocol through M5; the owner then froze it. It still says M5 awaits review and has no Treatment A, F10, workspace or Assistant refinement. Its PR #2 and simulation sections are dated 2026-10-01 |
| `docs/ui-data-contracts.md`, `docs/architecture.md` | Draft wire contracts and architecture (another engineer) | Drafts; endpoints do not exist |
| Graphify graph (outside the repo) | Code-relationship hints | Current as of 2026-10-06 17:14 (section 13) |

**Authority, highest first:**

1. The owner's latest explicit instructions.
2. Git plus the current code and tests.
3. This file, `DESIGN.md` and `VERSION_A.md`.
4. The feature briefs (for scope and acceptance).
5. `PROJECT_CONTEXT.md` and `AGENTS.md` (product background and durable rules).
6. Graphify.

## 3. Completed product state

**M0–M5** are committed locally:

- the Vite, React 19, TypeScript and zod shell;
- the approved equipment artwork;
- the fixture data layer with deterministic synthetic scenarios;
- interactive monitoring (fit, zoom and pan; selection; inspector; KPI details; issues);
- cooling prediction (a demo baseline) and equipment pages;
- the scripted AI Assistant.

The M5 review gate is closed (F10, 2026-10-05).

**The approved visual foundation is Treatment A: Graphite, Machined Bezel.** Do not
redesign it during M6. Build M6 surfaces in its language: graphite displays in a
bezel; laminate (the only light material) only for what asks for a decision;
outline tags for provenance; dashed tags for planned work; colour only for state. See
`DESIGN.md`.

**Current structure** (from the code):

- **Shell:** a 52 px top bar (location and h1, the Demo data tag, readouts, More
  readings, and the attention slot that always holds the most severe open issue); a
  56 px dock with Overview, Analytics, Engineering, Knowledge, then Shortcuts and
  System; and a 48 px deck (scenario, Live demo or Replay, timeline, the only clock).
- **Routes:**

  | Route | Screen |
  |---|---|
  | `/` | Overview: plant, or `?view=list` |
  | `/prediction` | Analytics |
  | `/engineering` | Hub: investigations, equipment records, Simulation (planned), CAD (planned) |
  | `/equipment/:id` | Equipment record |
  | `/equipment` | Overview list |
  | `/agent` | Assistant, full page |
  | `/simulation`, `/cad` | Engineering hub, with that row focused |
  | `/pilot`, `/knowledge`, `/setup`, `/system` | Planned screens |

- **Workspace,** the right column on every screen:
  - Details (equipment inspector or indicator) lead.
  - The **Assistant | Pilot** tabs and the composer sit below.
  - Typing, or opening Details from an answer, folds Details to a one-line strip.
  - Width 352 px, docked at 1440 px and wider (resizable 320–560 px, remembered).
  - Below 1440 px: a 52 px dock with a floating panel; the plant refits when it can stay
    at half size or more.
  - At 760 px and below: a full-screen sheet.
- **Pilot tab:** `src/app/workspace/PilotPanel.tsx` is a planned placeholder ("Simulation
  only; the pilot never controls physical equipment"). It links to the Engineering
  Simulation row and to `/pilot`.
- **State:** `src/app/operatingContext.ts` is one `useSyncExternalStore` store. It holds:
  - scenario, cursor and playing;
  - the selection, the KPI and highlights;
  - workspace open, tab, width and pin;
  - Details collapsed;
  - the Assistant's conversation and pending request.
- **Service seams:**
  - `DataClient` (`src/lib/api/client.ts`: site, snapshot, history, issues, forecasts);
  - `AgentClient` (`src/lib/api/agent.ts`).

  Both are fixture-backed (`src/fixtures/`) and selected in `src/app/dataClient.ts`.
  There is no live mode: a non-demo build shows "Local API not connected", and nothing
  falls back to fixtures.

## 4. The Assistant now (scripted demo)

**It is a scripted demonstration. No language model is connected.**

- A prompt is matched by keywords to one of five prepared investigations, or to an
  honest fallback (`src/fixtures/agentScripts.ts`).
- Every figure comes from simulated tools (`agentTools.ts`). They read the same
  synthetic data as the screens.
- The labels "Scripted demo", "Simulated tool" and "Replay paced for demonstration"
  stay.

**Behaviour after the 2026-10-06 refinement:**

- **The question appears at once.** The session shows the question before the harness
  replies, under a stable key (`conversationSession.ts`). It is followed by a quiet
  "Working" line (three bars), never narrated reasoning.
- **Steps read in plain words:** "Checking plant data…", then "Check plant data,
  Complete" (or "Failed" in caution). They fold into one "Used N simulated tools" line
  when the answer begins, and can be reopened (tool name, arguments and result
  inside).
- **The answer streams calmly** (`fixtureAgent.ts`, `paceText`):
  - a short pause before the first step and another before the text;
  - pieces of one to three words with varied gaps, longer after a clause, a sentence or
    a paragraph;
  - about 22–26 words a second;
  - `?agentSpeed=fast` (tests) runs the same events at 4% of the pace.
- **Rendering** (`Prose.tsx`):
  - a safe Markdown subset: paragraphs, headings, lists, pipe tables;
  - text only, never HTML;
  - the line being written fades in word by word behind a still caret;
  - a table shows once its header is complete and grows a row at a time;
  - text already shown keeps its DOM nodes.
- **Answer shape depends on the content:**
  - a sentence or two for a simple reading;
  - paragraphs for an explanation;
  - a list only for several separate issues;
  - a table only for several readings or shortfall periods.
- **Cancel works from the moment of asking.** A cancelled answer keeps what was written.
  An answer keeps streaming into its own conversation if another conversation is
  opened.
- **Follow mode** (`ConversationView.tsx`):
  - The view glides to each new line while the reader is at the end.
  - These stop following at once and halt any glide in flight: scrolling up, wheel
    up, Home, PageUp or ArrowUp, and pointer or focus inside earlier conversation.
  - "Jump to latest" returns to the end, follows again and keeps keyboard focus in the
    conversation.
  - Following resumes by itself when everything fits.
- **Reduced motion:** no fades, instant moves.
- **Accessibility:**
  - the conversation is a named, focusable region;
  - steps and details are buttons with `aria-expanded`;
  - "Answer complete." is announced.
- **Contract:** typed parts and events with zod validation at the boundary
  (`src/lib/contracts/agent.ts`). Events are text, tool calls and results, and typed
  views (equipment, issues, chart, link). Navigation targets are `monitoring_kpi`,
  `equipment`, `prediction` and `equipment_page`. Model output never becomes HTML,
  URLs or code.

**Verified 2026-10-06** (Windows 11, Node 24.19, Playwright 1.63 Chromium):

- typecheck passes;
- Vitest 53/53;
- Playwright 147 passed, with 6 opt-in screenshot tests skipped;
- `build` and `build:demo` pass.

A KPI Escape test failed once under full-suite load and passed 48/48 on rerun. Treat it
as a known intermittent risk.

**Not verified:**

- browsers other than Chromium;
- a real screen reader;
- a real touch device;
- the DGX Spark.

## 5. Requirement: natural-language understanding (not yet solved)

The scripted Assistant is too stiff. "I want to know whether there were broken
equipment since the last 24h" fails for two reasons:

- `matchIntent` is a handful of keyword regexes, and "broken" is not among them, so the
  question falls back to "only answers prepared questions".
- Even a matched question reports open issues at one instant: `list_issues` takes a
  single time. **No fault-history capability exists for a time range.**

**Required direction:**

- Do not grow brittle regex or exact-question aliases.
- Normalize natural language into **structured intents with parameters**. For
  example, "Was anything broken in the last 24 hours?", "Any equipment failures
  today?", "Show equipment problems since yesterday" and "Did anything fail?" all map
  to `{ intent: equipment_fault_history, time_range: last_24_hours }`.
- A small controlled router is acceptable for the scripted stage. It must use **the same
  structured intent and action boundary a real LLM will use later**, so nothing is
  disposable when a model is connected.

## 6. Product direction: the Assistant drives the main workspace

**Chat** holds the conversation and a concise explanation. **The main workspace** (the
shell's display area) holds the visual or detailed answer. The Assistant must not
become a chat panel full of large graphs, tables and reports.

```text
natural language -> intent -> controlled application action -> HVAC data/service
   -> main workspace changes (deterministic rendering)   +   concise streamed summary
```

| User | Main workspace | Chat |
|---|---|---|
| "Show me COP today." | Opens the COP trend | Key behaviour; "opened the trend" |
| "Compare it with yesterday." | Updates the same view into a comparison | The important difference |
| "All equipment status for the last 24 hours." | Opens the status or history table or report | Abnormal equipment, observations |
| "Was anything broken in the last 24 hours?" | Opens fault and equipment history | The conclusion |
| "Show Cooling Tower 4." | Focuses or highlights it in the right view | Its current state |
| "Investigate this issue." | Opens investigation and evidence | The finding |
| "Today's cooling-operation report." | Opens the full report | Executive summary |
| "Export this to Excel." | Generates the export deterministically from the same structured report data | The model never invents values |

**Controlled, typed application capabilities only.** The model must never rewrite React or
generate arbitrary UI. Conceptual names, not decided APIs:

- `show_chart`, `show_report`, `compare_periods`;
- `focus_equipment`, `open_equipment`, `open_details`;
- `show_equipment_history`, `show_fault_history`, `inspect_issue`;
- `show_simulation`, `export_report`.

Over time the workspace may adapt between plant, graph, table, equipment record,
report, investigation, simulation and Pilot results. Do not call it "AI Viewer" in the
architecture unless that name is chosen.

**Seeds in the code:**

- typed `view` parts and `NavTarget`s;
- `useContextNavigate` in `TurnView.tsx`, which applies a target through
  `operatingContext` (select, openKpi, highlight, setScenario, setCursor,
  setDetailsCollapsed) and the router.

A likely path is new typed action events, validated like views, dispatched through an
allow-list of application capabilities. **None of this is built, and it is not M6 scope
unless the owner approves it.**

## 7. Future composer: attachments and voice

The composer is text only (textarea, Send, Cancel). The owner wants attachment and
voice input eventually, styled in Graphite rather than copied from the reference.

- They are not functional in M6 unless separately approved.
- Never ship fake working controls. If anything is shown before it works, it reads as
  Planned.

## 8. AI Pilot product direction (interaction reference only)

The owner's reference shows a separate **Chat | AI Pilot** experience. The workspace
already has **Assistant | Pilot** tabs.

- **States:** Stopped, Monitoring, Investigating, and further lifecycle states as
  appropriate.
- **The Pilot panel** is a concise monitoring, narrative and control surface:
  - health and assessment state;
  - scan and history entries;
  - open issues with severity and state, and advisories;
  - investigation progress and evidence availability;
  - proposals, outcomes and resolution.
- **Details open in the main workspace.** For example, the panel says "Chiller 2:
  chilled-water setpoint appears colder than load requires"; the workspace shows the
  investigation, evidence, trends and simulation results.

The reference screenshots were shared in chat and are not in the repository; ask the
owner to share them again if needed. They are for interaction only, never styling.

## 9. M6 scope: Simulation and AI Pilot

The authoritative requirements are `src/features/simulation/README.md` and
`src/features/pilot/README.md`, with backend boundaries in
`src/hvac_agent/simulation/README.md` and `src/hvac_agent/pilot/README.md`.
`VERSION_A.md` places their mock services in M6.

**Simulation:**

- **Screens and components:** `SimulationPage`, `ScenarioForm`, `RunControls`,
  `SimulationTimeline`, `ResultsView`, `CorrectionHistory`.
- **Presentation:**
  - reuse the plant scene renderer;
  - a persistent Simulation label;
  - the run ID, config revision and simulated time.
- **Run control:**
  - run states governed by the backend: created, running, paused, stopped, failed;
  - duplicate-click protection;
  - pause as a backend operation;
  - reconnecting to the same run after refresh or navigation.
- **Corrections:**
  - each shows equipment, metric, value, units, allowed range and target run;
  - held manual overrides are distinct from baseline control, with explicit release
    when supported;
  - lifecycle: proposed, queued, rejected, superseded, expired, applied, measured
    outcome.
- **Results:**
  - demand, removed cooling, unmet demand, power and energy as distinct metrics;
  - forecasts with simulation origin (`source=simulation`) labelled as such.
- **Must exercise:**
  - solver and envelope failures;
  - invalid setpoints;
  - delayed and rejected actions;
  - reconnect;
  - a failure that keeps the last valid observation as retained data.
- **No real-equipment controls.**

**AI Pilot:**

- **Views:** issue list, investigation panel, evidence timeline, proposed-action detail,
  outcome view.
- **Lifecycle:** detection → investigation → proposal → application → outcome →
  resolution.
- **Operating conditions:** it operates only for an explicitly named simulation run, and
  only when the backend advertises support.
- **Must cover:**
  - no duplicate issue rows;
  - delayed reasoning never freezes monitoring;
  - failed tools and rejected or stale actions stay visible;
  - resolution links to its evidence;
  - the no-issue, no-backend, paused-run, ended-run and disconnection states;
  - accessible timeline navigation.

**Safety:** the AI Pilot is simulation-only. There is no physical HVAC actuation and no
switch to real equipment.

**F10 (owner, 2026-10-05):**

- M6 adds no Assistant simulation-control or action tools.
- Read-only Assistant access to simulation results may come later, if the architecture
  supports it safely.
- Any Assistant control or action involving simulation needs a separate confirmation
  design and the owner's explicit approval.

Design M6 with section 6's architecture in mind, but M6 does not include an agentic
Assistant that controls Simulation.

## 10. Simulation backend status

- **This branch:** the backend is scaffold only. `src/hvac_agent/simulation`, `pilot`,
  `agent`, `core` and `integrations` hold `__init__.py` and READMEs; `apps/api` has no
  code.
- **Last known remote state** (local refs from the last fetch, 2026-10-02):
  - `origin/feat/simulation-foundation` at `3d5663d` is 23 commits ahead of
    `origin/main`, with about 17k lines. It contains a vendored modified PHYVAC, the
    site schema, run clock and lifecycle, a correction gate and ledger, and held
    overrides.
  - It is merged into neither `origin/main` nor this branch.
  - `PROJECT_CONTEXT.md` (2026-10-01) records PR #2 as open with changes requested and
    four unresolved findings.
- **Not re-verified.** On 2026-10-06, `git ls-remote` returned "Repository not found"
  from this shell (no credentials), and `gh` is not installed. Re-check with the owner
  before relying on PR #2.
- **Implication:** M6 most likely starts with labelled mock Simulation and Pilot services
  behind a client seam like `DataClient` and `AgentClient`. Shape them after PR #2's
  semantics (run lifecycle, correction states, held overrides) so the real service can
  replace them.

## 11. Data and provenance

| Item | Status |
|---|---|
| Plant topology, telemetry, issues, history | **Synthetic**, deterministic fixtures. Scenarios: normal, peak, tower-fault, pump-trip, sensor-issues, disconnected, scene-mismatch, new-site. Labelled Demo data and Synthetic plant; never customer telemetry |
| Cooling forecast | **Demo baseline** (seasonal profile) computed in the browser; not a trained model; spread uncalibrated |
| Assistant | **Scripted**: keyword intent matching, prepared investigations; no LLM |
| Assistant tools | **Simulated**: they wrap the fixture DataClient; knowledge search is deliberately unavailable |
| Assistant pacing | **Artificial**, labelled "Replay paced for demonstration" |
| Simulation, AI Pilot | **Planned** placeholders; no service in this build |
| CAD Studio, Knowledge, Setup, System | **Planned** (M7) |
| API, PHYVAC, model, equipment | **Not connected** |
| Real | The dashboard code, its tests and builds |

Keep every provenance label. Never present synthetic data as customer data, scripted
answers as a model, simulated tools as real tools, or the Pilot as able to actuate
equipment.

## 12. Commands

From `apps/dashboard/`:

- `npm run demo`: dev server, `http://localhost:5173`. Check the port first.
- `npm run typecheck`, `npm test`, `npm run e2e` (Playwright reuses the server on
  5173), `npm run build`, `npm run build:demo`.

Useful URL parameters:

- `?scenario=<id>`;
- `?time=HH:MM`;
- `?agentSpeed=fast` (tests);
- `?fail=agent:unavailable`, `?fail=history:timeout` (failure injection).

## 13. Graphify

The graph lives outside the repository, at
`C:\Users\Crusher1\Documents\HVAC\graphify-hvac-agent\graphify-out\`. It supports
architecture questions; it is not memory, and Git is authoritative.

**Refreshed 2026-10-06 17:14** (owner-approved, code-only, out of repo; Git status
unchanged): 863 nodes, 2,483 edges. The deleted modules are gone; `Workspace`, `Prose`,
`AssistantPanel`, `DetailsPane`, `PilotPanel`, `EngineeringPage`, `EquipmentRecordPage`
and `conversationSession` are present. It does not model CSS.

Refresh again only with the owner's approval, using `CLAUDE.md`'s out-of-repo command. Record `git status` before and after. Never run
`graphify update`, `watch`, `hook install`, `claude install` or any extraction without
`--out`.

## 14. Open decisions for the owner

1. Done: Treatment A and the Assistant work are in a local checkpoint commit (not
   pushed). Push only on explicit instruction.
2. Update `PROJECT_CONTEXT.md`, which is frozen and stale? If wanted, propose a patch
   for approval; never edit it unasked.
3. The stale status lines in the dashboard README and briefs belong to another
   engineer. Leave them or have them updated?
4. Keep or remove the Graphify `hook-guard` hooks in `.claude/settings.json`?
5. Current PR #2 and simulation backend status, which was not verifiable from this
   machine.
6. Re-share the AI Pilot reference screenshots in the new session.

## 15. Recovery order for a fresh session

1. Read `CLAUDE.md`.
2. Read this file.
3. Read `apps/dashboard/DESIGN.md`.
4. Read `apps/dashboard/VERSION_A.md`.
5. Inspect Git: branch, HEAD, status, staged, untracked, and remotes if reachable.
6. Inspect the relevant code:
   - shell, routes and workspace;
   - `operatingContext`;
   - the DataClient and AgentClient seams;
   - the agent contract and fixtures;
   - the Simulation and Pilot placeholders and briefs.
7. Consult Graphify for architecture only, refreshed if the owner approved.
8. Reconcile the documents against the code; list every contradiction.
9. Report the recovered understanding, contradictions and risks to the owner.
10. Stop.
11. Wait for the owner's confirmation before planning or implementing M6.

Never assume a document is correct when Git or the code contradicts it.
