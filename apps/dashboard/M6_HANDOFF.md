# M6 handoff: HVAC Agent dashboard

**State recorded:** 2026-10-07 (Asia/Shanghai), after M6 (Simulation and AI Pilot, on
labelled mock services) was built, audited, revised to the owner's "consolidated
revision", then revised toward a text-first "JARVIS for HVAC", and corrected after the
owner's review. Each surface now has one job:

- **AI Pilot**, in the workspace, is the live operator: it sets up, starts, operates and
  monitors the run, and gives a short result when it ends.
- **The main display** stays the operator's own while the run goes on.
- **Simulation** (`/simulation/RUN-…`) is the replay of a recorded run.
- **Simulation history** is the archive.

The Assistant reads all of this through a typed, offline (no language model) pipeline. It
opens the views its answers are, follows up from the conversation, and points to operator
controls it cannot press.
**M6 is uncommitted and awaits the owner's visual and product review.** Section 9a
records what is built.

**M7, the Knowledge workspace (Graph RAG and Graph Memory), was built on 2026-10-08/09
at the owner's request and is uncommitted too.** It adds a real local service (Python
standard library, SQLite) and keeps a read-only demo. **M7.1 (2026-10-09) draws the
knowledge graph in 3D**, with react-force-graph-3d (installed by the owner), keeping the 2D
view. Section 9b records both. Nothing is staged, committed or pushed.

This is a current-state handoff, not a history. Git and the current files are
authoritative: verify every statement here against them before relying on it, and say
so when they disagree.

## 1. Repository and safety state

| Item | State on 2026-10-07 |
|---|---|
| Repository | `C:\Users\Crusher1\Documents\HVAC\hvac-agent` (origin `github.com/yxiao986/hvac-agent`) |
| Branch | `feat/dashboard-version-a`, local only, no upstream configured (never pushed, no PR) |
| HEAD | The local checkpoint commit after `709e642`: feat(dashboard): Treatment A (Graphite) redesign and Assistant refinement, 2026-10-06 |
| Commits on the branch | `origin/main` `85093f8` plus six local commits: `4376230` M0–M1, `b7c525f` M2–M3, `90abc0a` M3.1, `bb234a4` M4, `709e642` M5, then the Treatment A and Assistant checkpoint |
| Staged | Nothing |
| Uncommitted | The M6 work (section 9a) and, outside it: `CLAUDE.md` (kept local), tooling artifacts and the other engineer's work |

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
- `.playwright-mcp/` holds console logs, page snapshots and `m6-*.png` screenshots from
  Claude's browser checks (two logs predate M6). It is safe to delete with the owner's
  agreement.
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
| `apps/dashboard/M6_HANDOFF.md` | This file: current state, requirements and next steps | Current as of 2026-10-09 (M7 and M7.1 added) |
| `apps/dashboard/DESIGN.md` | The approved Treatment A design system (visual language, layout, components) | Current; matches the code |
| `apps/dashboard/VERSION_A.md` | Milestone log, owner decisions (F10), acceptance evidence | Current. Chronological: later sections supersede earlier ones (M5's "drawer" became the Treatment A workspace; the M6 consolidated revision supersedes the first M6 section's screens and Assistant) |
| `apps/dashboard/PRODUCT.md` | Users, tone and design principles for UI work | Current (2026-10-04) |
| `apps/dashboard/src/features/simulation/README.md`, `features/pilot/README.md` | M6 requirements and acceptance (briefs, another engineer) | Requirements authoritative; "Status: brief only" is still true |
| `apps/dashboard/src/features/knowledge/README.md`, `src/hvac_agent/knowledge/README.md`, `apps/api/README.md` | M7 requirements (briefs, another engineer) | Requirements authoritative. Their status lines ("brief only", "no server") are now stale; they are another engineer's files, so section 9b lists the facts to add |
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
  | `/trend` | One indicator across today or its last hours (M6; Analytics). `?metric=`, `?hours=` (1–24) |
  | `/engineering` | Hub: investigations, equipment records, Simulation history, CAD (planned) |
  | `/equipment/:id` | Equipment record |
  | `/equipment` | Overview list |
  | `/agent` | Assistant, full page |
  | `/simulation` | Simulation history: the archive of runs, read-only (M6; Engineering section) |
  | `/simulation/:runId` | Simulation replay of one recorded run (M6; h1 "Simulation"): summary, plant with a step scrubber, results, comparison, findings, corrections, events. `?issue=`, `?equipment=`, `?compare=` |
  | `/cad` | Engineering hub, with its row focused |
  | `/knowledge`, `/setup`, `/system` | Planned screens |

- **Workspace,** the right column on every screen:
  - Details (equipment inspector or indicator) lead.
  - The **Assistant | AI Pilot** tabs sit below (the Assistant's composer at the foot).
  - Typing, or opening Details from an answer, folds Details to a one-line strip.
  - Width 352 px, docked at 1440 px and wider (resizable 320–560 px, remembered).
  - Below 1440 px: a 52 px dock with a floating panel; the plant refits when it can stay
    at half size or more.
  - At 760 px and below: a full-screen sheet.
- **AI Pilot tab:** `src/features/pilot/PilotConsole.tsx`, the operator console and the
  only place a simulation is set up and operated (section 9a). It never moves the main
  display. When a run ends it shows a short result; "View summary & replay" opens the
  replay. AI Pilot has no page of its own.
- **State:** `src/app/operatingContext.ts` is one `useSyncExternalStore` store. It holds:
  - scenario, cursor and playing;
  - the selection, the KPI and highlights;
  - workspace open, tab, width and pin;
  - Details collapsed;
  - the Assistant's conversation and pending request.

  The simulation's own store is `src/features/simulation/simulationSession.ts`: the run
  AI Pilot works with, its view, chosen issue, set-up state and a pointed control. The
  replay and the history read runs on their own and never change it.
- **Service seams:**
  - `DataClient` (`src/lib/api/client.ts`: site, snapshot, history, issues, forecasts);
  - `AgentClient` (`src/lib/api/agent.ts`);
  - `SimulationClient` and `PilotClient` (`src/lib/api/simulation.ts`, M6), with the
    read-only `SimulationReader` and `PilotReader` the Assistant gets;
  - `TranscriptionClient` (`src/lib/api/speech.ts`, M6): speech-to-text, not connected
    in this build.

  All are fixture-backed (`src/fixtures/`) and selected in `src/app/dataClient.ts`.
  There is no live mode: a non-demo build shows "Local API not connected", and nothing
  falls back to fixtures.

## 4. The Assistant now (offline, no language model)

**No language model is connected.** Offline rules in the browser read each request; it
says so in words: the panel's badge "No language model connected" ("Assistant
unavailable" when the service fails), "Offline rules" and "Replay paced for
demonstration" on each answer, "Simulated tool" on each step.

**The pipeline** (one path for typed text, a transcription and attachments):

```text
message { prompt, attachments }                         (src/lib/contracts/agent.ts)
  -> offline understanding: concepts -> typed intent     (src/lib/agent/understand.ts)
  -> responder: simulated read-only tools -> answer     (src/fixtures/agentScripts.ts)
  -> events: text_delta, tool_call/tool_result, view, action, turn_end
  -> session validates every event (zod)                (features/agent/conversationSession.ts)
  -> shell applies an action through targetPath         (src/app/openTarget.ts)
  -> main workspace shows the view; the chat keeps a concise answer
```

- **Understanding** is not phrase matching: a request is reduced to what it is about
  (an indicator, equipment, a run or run ID, a pilot issue, attached files) and what is
  asked (show, a value, compare, a summary, change), so paraphrases meet ("show me COP",
  "how is our COP doing", "let me see COP performance"). Requests outside its vocabulary
  get an honest "outside what the offline rules cover", never a guess. Intents:
  attention, fault history (by period), equipment open, investigate or history, metric
  trend (today, the last N hours; the next N hours is the forecast) or value, shortfall,
  forecast, efficiency, simulation history, run summary, current simulation, pilot
  findings, pilot issue, compare runs, control (pointed to, never pressed), attachments,
  greeting, thanks, help, unresolved, unknown.
- **Follow-ups** read the conversation: its earlier requests are replayed into a `Focus`
  (subject, indicator, equipment, run, issue, time range), so "What about the last 6
  hours?", "And power?", "Show me its history" and "How about yesterday?" resolve against
  it. With nothing to refer to, the answer asks rather than guesses.
- **Tools** (`src/fixtures/agentTools.ts`): the M5 plant tools plus
  `list_simulation_runs`, `get_simulation_run`, `get_run_summary` and
  `get_pilot_findings`. The simulation and pilot are reached only through read-only
  facades; the tools cannot command, correct or switch monitoring.
- **Workspace actions:** one typed `action`, either `{ kind: "open", target: NavTarget,
  label }` or `{ kind: "reveal", control, runId?, issueId?, label }` (point to an operator
  control in AI Pilot). It is validated with every event, and applies only while its turn
  streams in the conversation being shown and before Stop; `applyAction`
  (`src/app/openTarget.ts`) maps it. Built targets: the indicator trend (`metric`, with
  `hours`), an equipment record, Cooling prediction at a forecast, Simulation history, a
  recorded run's summary and replay (at a finding, an item or a matched comparison), and
  AI Pilot's live run or one of its findings, shown in AI Pilot (`showInPilot`) without
  moving the main display. The composer keeps focus; completion is announced with the view's
  name; the answer ends with "Opened in the workspace: …" and "Open again" (or "Pointed to
  in AI Pilot (yours to press): …" and "Show again"). From the full page the conversation
  moves into the workspace at once; on a phone the view waits behind the sheet until
  "Open again".
- **Proactive routing:** when the answer is a view, it opens without being asked: "How has
  COP been today?" (the trend), the forecast question (Cooling prediction), "What is
  happening with Chiller 2?" (its record), run summaries and comparisons. **Ordinary
  questions** ("what's the COP now?", "is the plant meeting cooling demand?") are
  answered in the conversation with a link at most. **The conversation draws no charts**;
  charts are links or open in the main display.
- **Streaming, Stop and follow mode** are as refined on 2026-10-06 (calm pacing,
  `?agentSpeed=fast` for tests, safe Markdown subset, Cancel from the moment of asking,
  Escape in the composer, focus back to the composer, follow until the reader scrolls).
  A stopped answer applies no action.
- **Seeded conversations** (three) are produced by the same pipeline at load.

**Not built:** a language model client; days other than the one synthetic day
("yesterday" is said to be outside the data); period comparisons, reports and exports;
free-form questions about attachments.

## 5. Natural-language understanding: where it stands

The 2026-10-06 requirement (no regex pile; structured intents the real model will reuse)
is met for the offline stage: `understand.ts` produces typed intents with parameters and
the responders, tools and actions take them, so a local model can later produce the same
intents through the same tools and actions. The vocabulary is the site's equipment and
drawable indicators; its tests cover paraphrases per intent and the cases that must not
be read as control ("when did the simulation end?", "RUN-0001 vs RUN-0002").

## 6. Product direction: the Assistant drives the main workspace

**Chat** holds the conversation and a concise explanation. **The main workspace** holds
the visual or detailed answer. The table is the owner's direction; rows marked built
exist now.

| User | Main workspace | Chat | State |
|---|---|---|---|
| "Show me COP today." / "How has COP been today?" / "What about the last 6 hours?" | Opens the COP trend (today, or the last hours) | Now, range, average | Built |
| "What is happening with Chiller 2?" / "Show me its history." | Opens its record | Its state; its readings and issues today | Built |
| "What cooling demand is forecast for the next 6 hours?" | Opens Cooling prediction at that forecast | The baseline's figures | Built |
| "Stop the simulation." | Opens AI Pilot with Stop outlined (never pressed) | Says only the operator can | Built (F10) |
| "Open Chiller 2." | Opens its record | Its state | Built |
| "Tell me our simulation history." / "Open RUN-0008." / "Show me the last simulation." / "Compare the latest two simulations." / "Inspect PIL-0001-2." | Opens the history, the run's summary and replay, the matched comparison, the issue (in an ended run's replay; in AI Pilot for the live run) | The summary, the figures side by side, the issue's stage | Built (read only) |
| "Compare it with yesterday." | Updates the view into a comparison | The difference | Not built (one synthetic day; said so) |
| "All equipment status for the last 24 hours." / "Was anything broken?" | Status or fault history view | The conclusion | Answer only, by period; no fault history view |
| "Today's cooling-operation report." / "Export this to Excel." | Report, export | Summary | Not built |

**Controlled, typed application capabilities only.** The model must never rewrite React
or generate arbitrary UI; the allow-list is the `NavTarget` union and `targetPath`.

## 7. Composer: attachments and voice

- **Attachments work, in this browser only.** Text files (.txt, .md, .csv, .tsv, .json,
  .log; up to three of 512 kB) are read with `File.text()`, checked (type, size, binary
  content, duplicates, count; refusals named with the reason), shown as chips, and sent
  as text with the question; the harness checks the message again; the stored turn keeps
  names and sizes only. The offline answer describes the file from its content. No
  upload service, no binary formats, no free-form questions about a file.
- **Voice sits behind a speech-to-text boundary** (`src/lib/api/speech.ts`): an
  OpenAI-compatible local service at `/api/stt/v1` (`GET /models`, `POST
  /audio/transcriptions`). **This build has none**, so the control says "speech-to-text
  not connected", explains on press and never opens the microphone. `?stt=local` points
  the boundary at that path (tests mock it): record, Stop and transcribe or Discard, the
  words join the draft. **Dependency:** a local transcription service (for example a
  Whisper server behind the local API) and its configuration.

## 8. AI Pilot product direction (interaction reference only)

Built as the AI Pilot console (section 9a). The owner's reference shows a separate
**Chat | AI Pilot** experience; the workspace has **Assistant | AI Pilot** tabs.

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

- **Screens and components** (the brief's names): `SimulationPage`, `ScenarioForm`,
  `RunControls`, `SimulationTimeline`, `ResultsView`, `CorrectionHistory`. As revised, the
  form, run controls and corrections live in AI Pilot, and the page is Simulation
  history (section 9a).
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

**F10 (owner, 2026-10-05), with the consolidated revision (2026-10-06):**

- The Assistant has read-only access to simulation runs, summaries and the pilot's
  findings, and can open them in the workspace (owner-approved scope).
- It has no simulation-control or action tools: it cannot start, pause, step, resume or
  stop a run, switch monitoring, apply a proposal, change a setpoint or release an
  override. Such requests are declined in words; AI Pilot opens at the operator's control,
  outlined and named as theirs to press (a typed `reveal` action; nothing is pressed or
  focused but the note). Explicit console controls are the only way to operate a run.
- Any Assistant control or action involving simulation needs a separate confirmation
  design and the owner's explicit approval.

## 9a. M6 as built (uncommitted, 2026-10-07)

Full record in `VERSION_A.md` (the M6 section and the consolidated revision after it).

- **Boundary:** `src/lib/contracts/simulation.ts` and `src/lib/api/simulation.ts`, shaped
  after PR #2's run, submission and correction semantics (local ref `3d5663d`), plus the
  run summary contract and read-only facades.
- **Mock services:** `src/fixtures/simulationService.ts` (fixture arithmetic over the
  synthetic scenarios; owns run state on its own timers; session storage for reload;
  failure injection; `?simSpeed=fast`) and `src/fixtures/runSummary.ts` (the pilot's
  deterministic summary).
- **UI store:** `src/features/simulation/simulationSession.ts` (one poll loop while
  something shows it; the newest read wins; unchanged reads cause no re-render; `launch`
  creates, monitors and starts in one operation).
- **AI Pilot** (`src/features/pilot/`): the form, run band, pilot strip, readings, Live,
  Findings and Corrections, operated in the workspace's console (below). The **Simulation
  replay** (`SimulationView.tsx`) shows a recorded run.
- **Simulation history** (`src/features/simulation/HistoryPage.tsx`) is the archive;
  **Trend** (`src/features/trend/`).
- **Assistant:** sections 4 and 7.
- **Shared changes:** typed `targetPath` in `src/app/navigation.ts`; `openTarget.ts` (one
  way to open a target, for links and actions); `TREND_KEYS` in `kpiDefinitions.ts`;
  `matchedRuns` in the contract; `PlantViewport` takes a provenance `note` and an
  `inPage` wheel mode; the shell resets the display's scroll on a new screen and keeps
  focus in the assistant when it opens a view; the chart's name omits an empty unit;
  `ErrorCode` gained `INVALID_REQUEST` and `CONFLICT`.

**AI Pilot console revision (2026-10-07, details in `VERSION_A.md`):**

- `src/features/pilot/PilotConsole.tsx` (the console: set-up, operating, finished; Live
  or Outcome, Findings, Corrections; Apply and Decline; rename; the pointer note) and
  `SimulationView.tsx` (`/pilot`, read-only) replace `PilotPage.tsx` and
  `src/app/workspace/PilotPanel.tsx`, both deleted.
- The session holds the view, issue, set-up and pointer; an address leads only for what
  it names. Runs have names; proposals can be declined (mock services, storage `v3`).
- The Assistant: `reveal` actions, proactive `present()`, `Focus` follow-ups, time ranges,
  `unresolved`; `src/lib/agent/understand.ts` rewritten, its tests 53.
- Motion: `src/lib/motion.ts` (GSAP core). Smooth scrolling: `src/app/smoothScroll.ts`
  (Lenis), frames only while gliding.
- E2E helpers for the console: `e2e/pilot-console.ts`; `e2e/pilot.spec.ts` rewritten.

**Live operator and recorded replay (owner's correction, 2026-10-07, details in `VERSION_A.md`):**

- AI Pilot never moves the main display (no navigation on start, tab, finding, stop or
  completion). The finished phase is a short result with "View summary & replay"; a
  finding under its row carries the investigation and latest evidence.
- `SimulationView.tsx` became the canonical replay at `/simulation/:runId` (History's
  record view merged into it), with a step scrubber over `getObservation(runId, step)` and
  `heldAt`. `/pilot` is gone; `LivePanel`, `LiveTrends` and the address mirroring are
  removed.
- `HistoryPage.tsx` is the archive only; its live run opens AI Pilot.
- The bottom bar's scenario select is removed; `?scenario=` stays.
- Typed targets: `simulation` (history or a run's replay, with `issueId`), `pilot` (AI
  Pilot, `showInPilot`). "Show me the last simulation" opens the replay.

**Corrected during the audit and the revision** (details in `VERSION_A.md`): stale reads
and duplicate polls; a failed step counted; missing readings as zero; the initial
observation not scanned; reasoning after a run ended; outcomes pending forever; Apply
staying enabled; idempotency keys reused; the run identity scrolling away; Stop waiting
out a pause; the summary loading for ever without a pilot; a stale summary focused; the
Pilot page replacing an addressed run with the previous one; unannounced loading
placeholders; an unannounced failed run; the summary taking over from Findings; focus
leaving the conversation; checkbox-like state icons; misaligned history headers.

## 9b. M7 as built (uncommitted, 2026-10-08/09)

**What exists.** `/knowledge` has two tabs, **Graph RAG | Graph Memory**. Graph Memory has
no destination of its own, and AI Pilot does not touch either system.

**Backend.** Python 3.11+, standard library only; there are no new dependencies anywhere.

| Path | Role |
|---|---|
| `src/hvac_agent/knowledge/vocabulary.py` | The HVAC vocabulary and sentence cues (deterministic, schema-guided extraction) |
| `src/hvac_agent/knowledge/pipeline.py` | Validation, text extraction (Markdown, text; PDF through the adapter), sections, passages, mentions, relationships with evidence |
| `src/hvac_agent/knowledge/service.py` | `KnowledgeService`: the library, ingestion jobs, hybrid retrieval with rank fusion, the graph, evidence and passages |
| `src/hvac_agent/agent/memory.py` | `MemoryService`: what may be stored, provenance rules, typed links, supersession, deletion, the timeline and the memory graph |
| `src/hvac_agent/integrations/knowledge_store.py`, `memory_store.py` | One SQLite file each, with FTS5 |
| `src/hvac_agent/integrations/embeddings.py` | The OpenAI-compatible embeddings client, configured from the environment only |
| `src/hvac_agent/integrations/pdf_text.py` | The optional pypdf adapter |
| `src/hvac_agent/core/errors.py` | The shared error contract |
| `apps/api/local_server.py` | WSGI composition and the ingestion worker. It binds to 127.0.0.1, refuses other Host names, requires `X-HVAC-Client` on writes and sends no CORS |
| `scripts/export_knowledge_demo.py` | Writes the dashboard's two demo snapshots through the real services |
| `tests/test_knowledge.py`, `test_memory.py`, `test_local_api.py` | unittest, which CI's pytest also runs |

**Dashboard.**
- Contracts: `src/lib/contracts/knowledge.ts`, `memory.ts`.
- Clients: `src/lib/api/knowledge.ts`, `memory.ts`, `local.ts`.
- Demo adapters: `src/fixtures/knowledgeDemo.ts`, `memoryDemo.ts`, plus their JSON and
  `fixtures/knowledge/*.md`.
- Composition: `loadKnowledgeClients()` in `app/dataClient.ts`.
- The feature: `src/features/knowledge/` (a lazy route) and its strings in
  `src/lib/i18n/knowledge.ts`.
- The dev proxy: `vite.config.ts`.
- Tests: `e2e/knowledge.spec.ts` (demo) and `e2e/knowledge-local.spec.ts` (starts the real
  service on a temporary folder and checks persistence across a restart).

**Demo and real never mix.**
- The demo is read only:
  - the synthetic library is indexed by the real pipeline;
  - the synthetic records follow the real memory rules;
  - nothing claims a model.
- `?knowledge=local` uses the local service for both tabs. Its errors are shown, never
  replaced by fixtures.
- The persistent memory refuses Demo provenance.

**Limits.**
- No language model: no answers and no model extraction.
- No embedding server: no vectors.
- PDF needs `pip install pypdf`; scanned PDFs need OCR.
- Plain-text headings are numbered ("1.2 …") or in capitals only.
- Rule extraction relates what the vocabulary names within a sentence, so it misses
  pronouns and can misread compound sentences. Each relationship shows its evidence.
- The demo's keyword ranking approximates FTS5.
- One global database lock.
- No accounts, so the service is loopback only.

**For the AI Pilot (later milestone).** The typed seams are `KnowledgeClient` and
`MemoryClient` (or the Python services), giving:
- `searchKnowledge`: cited passages;
- `inspectEvidence` and `getPassage`: navigation targets;
- `searchMemories` and `getMemoryTimeline`;
- `createMemory`: through a proposal the operator confirms; nothing is saved
  automatically.

The assistant's `search_knowledge` tool is deliberately still unavailable. A `knowledge`
NavTarget (`passage`, `node`, `mem`) would map onto the addresses that exist already.
Retrieved text and memory are untrusted data: never instructions, never control (F10).

**M7.1, the knowledge graph in 3D (uncommitted, 2026-10-09).**

| Path | Role |
|---|---|
| `src/features/knowledge/graph/GraphCanvas3D.tsx` | The 3D view, a lazy chunk: fixed positions, highlight and fade, HTML names with decluttering, the camera, keyboard, drawing on demand, the WebGL fallback signal |
| `src/features/knowledge/graph/layout.ts` | Adds `documentWeights`, `clusterLayout3d`, `declutter` and `nearestInDirection` (tested in `layout.test.ts`) |
| `src/features/knowledge/graph/noWebgpu.ts` | The stand-in for `three/webgpu` (aliased in `vite.config.ts`, excluded from pre-bundling) |
| `src/features/knowledge/rag/KnowledgeGraphView.tsx` | Families and colours, the grouped legend, **3D \| 2D** in the address (`gv`), WebGL and high-contrast detection, the error boundary |
| `src/features/knowledge/shared.tsx` | `SidePanel` returns focus to what opened it |
| `src/lib/motion.ts` | `travel`: the 3D camera's 500 ms ease in and out |

- `react-force-graph-3d` is in `package.json` (the owner's change). Its dependency
  three.js has no types in this project, so the component types the camera and controls it
  uses itself.
- Limits:
  - the 3D chunk is 799 kB (211 kB gzip);
  - layouts are O(n²) per step (fine at the 300-node cap);
  - the WebGL canvas is not readable by screen readers: the announcements, the panels and
    the 2D view carry its content;
  - only SwiftShader has drawn it (no hardware GPU or the DGX Spark yet).

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
| Assistant | **Offline rules, no language model**: typed intents from offline understanding; labelled "No language model connected" and "Offline rules" |
| Assistant tools | **Simulated, read only**: they wrap the fixture DataClient and read-only facades of the mock simulation and pilot; knowledge search is deliberately unavailable |
| Assistant attachments | **Real, in this browser**: text files read client-side and sent as text; no upload service |
| Voice input | **Not connected**: a speech-to-text boundary with no service in this build; the microphone is never opened |
| Run summary | **Deterministic**, written by the mock pilot from the run's records; labelled "From the recorded run"; no language model |
| Assistant pacing | **Artificial**, labelled "Replay paced for demonstration" |
| Simulation, AI Pilot | **Mock services** in the browser (demo mode), labelled Mock simulation service and Mock pilot service: fixture arithmetic, not PHYVAC; rule-based screening and scripted reasoning, not a model. Simulation only; nothing reaches equipment |
| CAD Studio, Knowledge, Setup, System | **Planned** (M7) |
| API, PHYVAC, model, equipment | **Not connected** |
| Real | The dashboard code, its tests and builds |

Keep every provenance label. Never present synthetic data as customer data, offline
answers as a model, simulated tools as real tools, a transcription that did not happen,
or the Pilot as able to actuate equipment.

## 12. Commands

From `apps/dashboard/`:

- `npm run demo`: dev server, `http://localhost:5173`. Check the port first.
- `npm run typecheck`, `npm test`, `npm run e2e` (Playwright reuses the server on
  5173), `npm run build`, `npm run build:demo`.

Useful URL parameters:

- `?scenario=<id>`: the demo telemetry's scenario (the only way to choose it; there is
  no scenario switch on screen, and a simulation chooses its own in AI Pilot);
- `?time=HH:MM`;
- `?agentSpeed=fast` (tests);
- `?fail=agent:unavailable`, `?fail=history:timeout` (failure injection);
- `?simSpeed=fast` (tests), `?fail=simulation:unavailable|solver|disconnect`,
  `?fail=pilot:unavailable|slow` (M6 mock services);
- `?stt=local` (tests): points voice input at the same-origin `/api/stt/v1`, which no
  build serves; tests mock it.
- `?knowledge=local`: the Knowledge workspace uses the local knowledge and memory service
  (below) through the dev server's proxy, never the demo;
  `?fail=knowledge:unavailable|empty`, `?fail=memory:unavailable|empty` (demo).

The local knowledge and memory service, from the repository root:

- `python apps/api/local_server.py`: http://127.0.0.1:8765, with data in the ignored
  `var/` (`--data-dir` and `--port` to change; the dev proxy expects 8765).
- Optional: `HVAC_EMBEDDINGS_BASE_URL` and `HVAC_EMBEDDINGS_MODEL` (an OpenAI-compatible
  embedding server); `pip install pypdf` for PDF.
- `python -m unittest discover -s tests` (or `pytest`): the backend tests.
- `python scripts/export_knowledge_demo.py` after changing the vocabulary, the pipeline or
  the demo documents (a test fails until it is run).

## 13. Graphify

The graph lives outside the repository, at
`C:\Users\Crusher1\Documents\HVAC\graphify-hvac-agent\graphify-out\`. It supports
architecture questions; it is not memory, and Git is authoritative.

**Refreshed 2026-10-06 17:14** (owner-approved, code-only, out of repo; Git status
unchanged): 863 nodes, 2,483 edges. It predates the M6 revisions: it still has
`PilotPanel`, the AI Pilot page and History's record view, and lacks `PilotConsole`, the
replay (`SimulationView`), `motion.ts` and `smoothScroll.ts`. It also predates M7 and
M7.1: no Knowledge workspace, none of the Python knowledge or memory services and no 3D
graph. It does not model CSS.

Refresh again only with the owner's approval, using `CLAUDE.md`'s out-of-repo command. Record `git status` before and after. Never run
`graphify update`, `watch`, `hook install`, `claude install` or any extraction without
`--out`.

## 14. Open decisions for the owner

1. M6 review: approve, or ask for changes, before anything is staged or committed.
2. Update `PROJECT_CONTEXT.md`, which is frozen and stale? If wanted, a patch is proposed
   for approval; it is never edited unasked.
3. The stale status lines in the dashboard README and briefs belong to another
   engineer. Leave them or have them updated?
4. Keep or remove the Graphify `hook-guard` hooks in `.claude/settings.json`?
5. Current PR #2 and simulation backend status, which was not verifiable from this
   machine.
6. The pilot's correction model: proposals wait for an operator to apply them to the
   simulation. Autonomous correction of the simulation would need the owner's decision.
7. A speech-to-text service for voice input (which engine, where it runs on the DGX
   Spark, and the endpoint the build should use), and a local language model for the
   Assistant; neither exists here.
8. On the Simulation replay and history screens the top bar still shows the plant's demo
   telemetry (labelled Demo data) beside recorded simulated values; keep, or mark it on
   those screens?
9. The single JS bundle is 928 kB (287 kB gzip), of which GSAP core is about 70 kB
   (27 kB gzip) and Lenis about 19 kB (5 kB gzip); code-split, or load GSAP only when
   something first moves?
10. Proposals are decided one at a time with Apply or Decline in AI Pilot. Should a
    declined proposal be offered again when the pilot sees the same issue later?
11. With the bottom bar's scenario switch gone, the demo telemetry's scenario comes from
    the address, or from a link in a conversation recorded with another scenario (which
    switches the plant to that recorded context). There is no on-screen way back but a
    reload. Keep, or keep such links in the current scenario?
12. The replay shows an issue's current stage at earlier steps, because stages are not
    recorded per step. Should the pilot service record stage history?
13. M7 review: approve the Knowledge workspace, or ask for changes.
14. M7 storage and transport: SQLite (standard library) and a WSGI composition were
    chosen because nothing else exists. Keep, or move to Neo4j or another store, and
    choose the API framework (`apps/api/README.md` leaves it open)?
15. Install pypdf for PDF manuals? Which embedding model and server on the DGX Spark? A
    local language model for answers and model-based extraction?
16. Authentication before the service listens beyond this machine; and retention: should
    superseded memory versions expire?
17. The knowledge briefs (another engineer's) ask to be updated with the supported formats
    and endpoints; section 9b has the facts. Update them, or leave it to their owner?
18. M7.1 review: approve the 3D knowledge graph and its family colours (which also colour
    the 2D view), or ask for changes. Should 3D stay the default?

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
   - the Simulation, Pilot and Assistant features and their briefs;
   - the Knowledge workspace (`src/features/knowledge/`), its services
     (`src/hvac_agent/knowledge/`, `agent/memory.py`, `integrations/*_store.py`) and
     `apps/api/local_server.py`.
7. Consult Graphify for architecture only, refreshed if the owner approved.
8. Reconcile the documents against the code; list every contradiction.
9. Report the recovered understanding, contradictions and risks to the owner.
10. Stop.
11. Wait for the owner's confirmation before changing M6, M7 or M7.1, or starting
    another milestone.

Never assume a document is correct when Git or the code contradicts it.
