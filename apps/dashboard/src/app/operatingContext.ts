/**
 * Shared operating context: demo scenario, playback clock, selected and highlighted
 * equipment, the Details target, the workspace and the Overview's drawing settings.
 * Owned by the app shell; features read it through the hooks below. The playback clock
 * is the demo's source clock; it never steps a simulation.
 */
import { useSyncExternalStore } from "react";
import { DAY_START, MINUTE_MS, SAMPLES, STEP_MIN } from "../fixtures/generate";
import { scenarioById, scenarios, type ScenarioId } from "../fixtures/scenarios";

export type PlaybackMode = "live" | "replay";
export type WorkspaceTab = "assistant" | "pilot";
/** Readings on the drawing. Auto shows key readings below 80% zoom and all above. */
export type ReadMode = "auto" | "key" | "all" | "off";
export type OverviewView = "schematic" | "list";

export interface OperatingContext {
  scenarioId: ScenarioId;
  /** Current observation time on the demo source clock (epoch ms). */
  cursor: number;
  mode: PlaybackMode;
  playing: boolean;
  /** Replay speed multiplier. */
  speed: number;
  selectedId: string | null;
  /** Plant indicator shown in Details; never at the same time as selected equipment. */
  kpiKey: string | null;
  /** Move focus into Details when an operator action opened them (not a deep link). */
  detailsFocus: boolean;
  /** Typing in the assistant handed the space to the conversation; Details show as a strip. */
  detailsCollapsed: boolean;
  /** Equipment highlighted by another feature (assistant, pilot), not selected. */
  highlightIds: string[];
  /** A request to centre equipment on the plant without selecting it. */
  locateRequest: { id: string; nonce: number } | null;
  /** A request to fit the plant to its box (keyboard F). */
  fitRequest: number;
  /** Readings mode, and what Auto currently resolves to (published by the drawing). */
  readMode: ReadMode;
  readEffective: Exclude<ReadMode, "auto">;
  overviewView: OverviewView;
  /** Issue IDs acknowledged in this browser session. Not recorded at the site. */
  acknowledged: string[];
  /** The right-hand workspace: Details above the Assistant or Pilot. */
  workspace: {
    open: boolean;
    tab: WorkspaceTab;
    width: number;
    /** Opened only to show Details, so it closes again with them. */
    autoOpened: boolean;
  };
  /** Assistant conversation shown, and a question asked from elsewhere. */
  assistant: {
    conversationId: string | null;
    request: { prompt: string; equipmentId: string | null; nonce: number } | null;
  };
}

export const DAY_END = DAY_START + (SAMPLES - 1) * STEP_MIN * MINUTE_MS;
export const REPLAY_SPEEDS = [60, 300, 900];
export const WORKSPACE_MIN = 320;
export const WORKSPACE_MAX = 560;
export const WORKSPACE_DEFAULT = 352;
/** Docked beside the page, and open by default, from here up. Below it the workspace
 *  collapses to a dock and its panels float over the drawing. */
export const WIDE = "(min-width: 1440px)";
export const NARROW = "(max-width: 760px)";
/** Key readings below this zoom when the readings mode is Auto. */
export const KEY_BELOW = 0.8;

const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
const initialScenario = scenarioById(params.get("scenario") ?? "") ?? scenarios[0];

/** `?time=14:12` sets the initial demo time (site-local). */
function initialCursor(minuteDefault: number) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(params.get("time") ?? "");
  const minute = m ? Number(m[1]) * 60 + Number(m[2]) : minuteDefault;
  return DAY_START + minute * MINUTE_MS;
}

// Per-browser convenience only: storage can be blocked, so every access is guarded.
const STORE_KEY = "hvac-agent.workspace";
function readPreference(): { open?: boolean; width?: number; tab?: WorkspaceTab } {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function savePreference() {
  try {
    const w = state.workspace;
    localStorage.setItem(STORE_KEY, JSON.stringify({ open: w.open, width: w.width, tab: w.tab }));
  } catch {
    // Not stored; the defaults apply next time.
  }
}

export const clampWidth = (w: number, viewport = typeof innerWidth === "number" ? innerWidth : 1440) =>
  Math.round(Math.min(Math.max(w, WORKSPACE_MIN), Math.max(WORKSPACE_MIN, Math.min(WORKSPACE_MAX, viewport * 0.4))));

const openByDefault = typeof matchMedia !== "undefined" && matchMedia(WIDE).matches;
const narrowAtStart = typeof matchMedia !== "undefined" && matchMedia(NARROW).matches;
const pref = readPreference();
const readParam = params.get("read");

let state: OperatingContext = {
  scenarioId: initialScenario.id,
  cursor: initialCursor(initialScenario.defaultMinute),
  mode: params.get("mode") === "live" ? "live" : "replay",
  playing: false,
  speed: REPLAY_SPEEDS[0],
  selectedId: null,
  kpiKey: null,
  detailsFocus: false,
  detailsCollapsed: false,
  highlightIds: [],
  locateRequest: null,
  fitRequest: 0,
  readMode: readParam === "key" || readParam === "all" || readParam === "off" ? readParam : "auto",
  readEffective: "all",
  // Phones open on the list; `?view=list` (the old /equipment roster address) does too.
  overviewView: params.get("view") === "list" || narrowAtStart ? "list" : "schematic",
  acknowledged: [],
  // Open beside the page on wide screens; collapsed (or hidden on phones) otherwise.
  workspace: {
    open: openByDefault && pref.open !== false,
    tab: pref.tab === "pilot" ? "pilot" : "assistant",
    width: clampWidth(pref.width ?? WORKSPACE_DEFAULT),
    autoOpened: false,
  },
  assistant: { conversationId: null, request: null },
};
const listeners = new Set<() => void>();

function set(patch: Partial<OperatingContext>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

/** Apply a Details change and open or close the workspace with it. */
function setDetails(patch: Pick<OperatingContext, "selectedId" | "kpiKey" | "detailsFocus">) {
  const had = Boolean(state.selectedId || state.kpiKey);
  const has = Boolean(patch.selectedId || patch.kpiKey);
  let workspace = state.workspace;
  if (has && !had && !workspace.open) workspace = { ...workspace, open: true, autoOpened: true };
  if (!has && had && workspace.autoOpened) workspace = { ...workspace, open: false, autoOpened: false };
  // New Details lead (V4: Details first); the same Details keep their place.
  const same = patch.selectedId === state.selectedId && patch.kpiKey === state.kpiKey;
  set({ ...patch, workspace, detailsCollapsed: same && has ? state.detailsCollapsed : false });
}

export function useOperating<T>(select: (s: OperatingContext) => T): T {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => select(state),
  );
}

export const getOperating = () => state;

const clampTime = (t: number) => Math.min(DAY_END, Math.max(DAY_START, t));

export const operating = {
  /** Changing scenario resets time and clears highlights; selection survives if the ID exists. */
  setScenario(id: ScenarioId) {
    const def = scenarioById(id)!;
    set({ scenarioId: id, cursor: DAY_START + def.defaultMinute * MINUTE_MS, playing: false, highlightIds: [] });
  },
  setCursor: (t: number) => set({ cursor: clampTime(t) }),
  setMode: (mode: PlaybackMode) => set({ mode, playing: mode === "live" }),
  setPlaying: (playing: boolean) => set({ playing }),
  setSpeed: (speed: number) => set({ speed }),
  /** Select equipment (or none); it replaces an open indicator in Details. */
  select: (id: string | null, focus = false) => setDetails({ selectedId: id, kpiKey: id ? null : state.kpiKey, detailsFocus: focus }),
  /** Show a plant indicator in Details; it replaces selected equipment. */
  openKpi: (key: string, focus = false) => setDetails({ selectedId: null, kpiKey: key, detailsFocus: focus }),
  closeKpi: () => setDetails({ selectedId: state.selectedId, kpiKey: null, detailsFocus: false }),
  /** Close whatever Details show. */
  closeDetails: () => setDetails({ selectedId: null, kpiKey: null, detailsFocus: false }),
  highlight: (ids: string[]) => set({ highlightIds: ids }),
  locate: (id: string) => set({ locateRequest: { id, nonce: Date.now() } }),
  requestFit: () => set({ fitRequest: Date.now() }),

  setReadMode: (readMode: ReadMode) => set({ readMode }),
  setReadEffective: (readEffective: OperatingContext["readEffective"]) => {
    if (state.readEffective !== readEffective) set({ readEffective });
  },
  /** Keyboard R: key, all, off in turn; from Auto, the mode after the one it shows. */
  cycleReadMode() {
    const order: Exclude<ReadMode, "auto">[] = ["key", "all", "off"];
    const from = state.readMode === "auto" ? state.readEffective : state.readMode;
    set({ readMode: order[(order.indexOf(from) + 1) % order.length] });
  },
  setOverviewView: (overviewView: OverviewView) => set({ overviewView }),

  /** Acknowledge issues in this browser only; the site records nothing. */
  acknowledge: (ids: string[]) => set({ acknowledged: [...new Set([...state.acknowledged, ...ids])] }),

  /** Details-first handover: typing collapses Details to a strip; the strip restores them. */
  setDetailsCollapsed: (detailsCollapsed: boolean) => {
    if (state.detailsCollapsed !== detailsCollapsed) set({ detailsCollapsed });
  },

  openWorkspace(tab?: WorkspaceTab) {
    set({ workspace: { ...state.workspace, open: true, autoOpened: false, tab: tab ?? state.workspace.tab } });
    savePreference();
  },
  closeWorkspace() {
    set({ workspace: { ...state.workspace, open: false, autoOpened: false } });
    savePreference();
  },
  /** Collapse without changing the remembered preference (e.g. the window became narrow). */
  hideWorkspace: () => set({ workspace: { ...state.workspace, open: false, autoOpened: false } }),
  setWorkspaceTab(tab: WorkspaceTab) {
    set({ workspace: { ...state.workspace, tab } });
    savePreference();
  },
  setWorkspaceWidth(width: number, save = false) {
    set({ workspace: { ...state.workspace, width: clampWidth(width) } });
    if (save) savePreference();
  },

  showConversation: (conversationId: string | null) => set({ assistant: { ...state.assistant, conversationId } }),
  /** Open the assistant and ask a question in a new conversation with this context. */
  askAssistant: (prompt: string, equipmentId: string | null = null) =>
    set({
      assistant: { conversationId: null, request: { prompt, equipmentId, nonce: Date.now() } },
      workspace: { ...state.workspace, open: true, autoOpened: false, tab: "assistant" },
      detailsCollapsed: true,
    }),
  clearAssistantRequest: () => set({ assistant: { ...state.assistant, request: null } }),
  /** Advance the demo clock by `wallMs` of wall time. Called by the shell's ticker. */
  tick(wallMs: number) {
    if (!state.playing) return;
    const step = state.mode === "live" ? wallMs : wallMs * state.speed;
    const next = clampTime(state.cursor + step);
    set({ cursor: next, playing: next < DAY_END });
  },
};
