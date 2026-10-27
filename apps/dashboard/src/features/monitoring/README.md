# Monitoring — primary screen

**Assignment:** implement `/`, the main operator view. Follow the
[dashboard standards](../../../README.md). Status (2026-10-04): Version A fixture
prototype implemented (`MonitoringPage`, `PlantViewport`/`PlantScene` with fit/zoom/pan
and selection, `KpiStrip`, `RecentIssues`) against demo fixtures only; since 2026-10-15 the
Overview's second view is the [AI display](../display/README.md) instead of `EquipmentList`;
no live API integration. Acceptance evidence: [VERSION_A.md](../../../VERSION_A.md).

**Owner change, 2026-10-15:** the plant runs only while it plays. The deck opens on the
live demo, paused ("Plant off"), at 60×; **Run simulation** (or **Play replay** in the
replay) starts it. The live simulation and the replay never run together: the other
source cannot be chosen while one plays, and an AI Pilot simulation run, which keeps its
own clock, keeps the replay waiting until it is paused in AI Pilot. Starting AI Pilot runs
the simulation; running the simulation never starts AI Pilot, and AI Pilot is refused
while a replay plays. The rules live in `app/operatingContext.ts`.

## Components and layout

Own `MonitoringPage`, `PlantScene`, `SceneToolbar`, `CurrentReadings` and
`RecentIssues`. Render the compiled CAD scene as the dominant central surface with
pan/zoom, fit-to-plant, equipment search and a state legend. Keep current readings
above it and forecast/issue summaries below or beside it as space allows. Do not
replace the equipment scene with a generic KPI card grid.

Select equipment by its stable ID to open the shared
[EquipmentInspector](../equipment/README.md). Import `CoolingForecastSummary` from
[prediction](../prediction/README.md) beneath the scene on desktop; on narrow
screens place it immediately after the scene/list. Its "View forecast" link opens
`/prediction` with the same source/run/revision and forecast identity. Monitoring
does not calculate forecasts or fetch them through a second client.

## Data and behavior

Read scene manifest, equipment catalog, latest readings, issues and operating context
through the local API. Bind sprites and readouts by equipment ID and metric, never
by array position or a label. Scene revision and data configuration revision must
match; show a mismatch instead of animating the wrong layout. Actual CAD-derived
assets stay in local runtime storage and are served by the API.

Animate pumps/fans/flow only from reported state. Stopped, fault, unknown and stale
states need distinct text/icon cues. Disconnect freezes motion and labels retained
values; it does not imply that real equipment stopped. Reduced motion uses static
state indicators. Freshness uses observation time, not the last paint event.

The initial screen is live telemetry when available. Simulation visualization must
show the selected run and simulation time persistently; it must never overwrite
the live source silently. Provide a useful equipment-list fallback for missing or
unsupported scenes and for accessible/narrow-screen navigation.

## Acceptance

Use healthy, empty, stale, disconnected and revision-mismatch fixtures. Verify
selection opens the same equipment across scene/list/chat; changing context discards
old data; forecast detail and summary agree; unknown values remain unknown. Stress
a large generated roster without hard-coded equipment counts. Confirm keyboard
access, reduced motion and no repeated model/step calls from rendering. Record
fixture and live-integration status separately in this README and project context.
