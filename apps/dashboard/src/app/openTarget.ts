/**
 * Applying what the assistant asks of the workspace: a link in an answer, or an action
 * (open a typed view; point to an operator control in AI Pilot). Targets are validated
 * data; `targetPath` maps them to screens, and AI Pilot's run is shown in AI Pilot. A
 * pointed control is outlined, never pressed.
 */
import { useEffect } from "react";
import { useNavigate, type NavigateFunction } from "react-router";
import type { AgentContext, NavTarget, WorkspaceAction } from "../lib/contracts/agent";
import type { ScenarioId } from "../fixtures/scenarios";
import { isKpiKey } from "../features/monitoring/kpiDefinitions";
import { session } from "../features/agent/conversationSession";
import { simulationSession } from "../features/simulation";
import { segmentOf, targetPath } from "./navigation";
import { getOperating, NARROW, operating } from "./operatingContext";

/**
 * Telemetry views open in the conversation's own context: the demo scenario and time it
 * was recorded with, so what opens shows the data the answer read.
 */
export function openInContext(navigate: NavigateFunction, context: AgentContext, path: string, prepare?: () => void) {
  const now = getOperating();
  const scenario = context.demoScenario?.id as ScenarioId | undefined;
  if (scenario && scenario !== now.scenarioId) operating.setScenario(scenario);
  if (Date.parse(context.at) !== now.cursor) operating.setCursor(Date.parse(context.at));
  operating.setPlaying(false);
  prepare?.();
  // Details opened from an answer wait as a strip, so the answer stays in view.
  const q = new URLSearchParams(path.split("?")[1] ?? "");
  const equipment = q.get("equipment");
  const kpi = q.get("kpi");
  if (equipment) operating.select(equipment);
  else if (isKpiKey(kpi)) operating.openKpi(kpi);
  if (equipment || isKpiKey(kpi)) operating.setDetailsCollapsed(true);
  navigate(path);
}

/** A recorded run is its own source: opening it leaves the telemetry scenario and time as
 *  they are. AI Pilot's run is shown in AI Pilot, and the main display stays where it is. */
export function openTarget(navigate: NavigateFunction, context: AgentContext, target: NavTarget) {
  if (target.type === "pilot") showInPilot(target);
  else if (target.type === "simulation") navigate(targetPath(target));
  else openInContext(navigate, context, targetPath(target));
}

/** Show a run in AI Pilot (a finding of it, or one of its views), beside whatever the main
 *  display shows. */
export function showInPilot(target: Extract<NavTarget, { type: "pilot" }>) {
  if (target.runId && target.runId !== simulationSession.current().runId) simulationSession.attach(target.runId);
  if (target.issueId) simulationSession.selectIssue(target.issueId);
  else if (target.view && target.view !== "summary") simulationSession.setView(target.view);
  operating.openWorkspace("pilot");
  operating.setDetailsCollapsed(true);
}

/** Leaving the full assistant page for what an answer opened: the workspace takes up the
 *  answer's conversation at once, not when the page would have passed it on (a quick
 *  answer can leave before that, and the workspace would show none). */
function leavingAgentPage() {
  if (segmentOf(location.pathname) !== "agent") return false;
  operating.showConversation(session.current().id);
  return true;
}

/**
 * Point to an operator control in AI Pilot: its run is shown there, the control outlined
 * and named, and AI Pilot opened. Nothing is pressed or focused but the note (F10).
 */
function revealControl(navigate: NavigateFunction, action: Extract<WorkspaceAction, { kind: "reveal" }>) {
  // The full assistant page hides the workspace: the Overview takes the display so AI Pilot can open.
  if (leavingAgentPage()) navigate("/");
  if (action.runId && action.runId !== simulationSession.current().runId) simulationSession.attach(action.runId);
  simulationSession.point(action.control, action.issueId ?? null);
  operating.openWorkspace("pilot");
  operating.setDetailsCollapsed(true);
}

export function applyAction(navigate: NavigateFunction, context: AgentContext, action: WorkspaceAction) {
  if (action.kind === "reveal") return revealControl(navigate, action);
  // From the full assistant page the conversation moves into the workspace, beside the
  // view it opened (on a phone the view shows; the conversation is a tap away). AI Pilot
  // opens over the Overview.
  if (leavingAgentPage()) {
    if (action.target.type === "pilot") navigate("/");
    else if (!matchMedia(NARROW).matches) operating.openWorkspace("assistant");
  }
  openTarget(navigate, context, action.target);
}

/** The shell applies the assistant's workspace actions as they stream. */
export function useAssistantActions() {
  const navigate = useNavigate();
  useEffect(() => session.onAction((action, context) => applyAction(navigate, context, action)), [navigate]);
}
