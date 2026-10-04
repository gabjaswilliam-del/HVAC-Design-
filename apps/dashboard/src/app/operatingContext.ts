/**
 * Shared operating context: demo scenario, playback clock, selected and highlighted
 * equipment. Owned by the app shell; features read it through the hooks below.
 * The playback clock is the demo's source clock; it never steps a simulation.
 */
import { useSyncExternalStore } from "react";
import { DAY_START, MINUTE_MS, SAMPLES, STEP_MIN } from "../fixtures/generate";
import { scenarioById, scenarios, type ScenarioId } from "../fixtures/scenarios";

export type PlaybackMode = "live" | "replay";

export interface OperatingContext {
  scenarioId: ScenarioId;
  /** Current observation time on the demo source clock (epoch ms). */
  cursor: number;
  mode: PlaybackMode;
  playing: boolean;
  /** Replay speed multiplier. */
  speed: number;
  selectedId: string | null;
  /** Equipment highlighted by another feature (assistant, pilot), not selected. */
  highlightIds: string[];
  /** AI assistant drawer: open state, shown conversation and a pending question. */
  assistant: {
    open: boolean;
    conversationId: string | null;
    request: { prompt: string; equipmentId: string | null; nonce: number } | null;
  };
}

export const DAY_END = DAY_START + (SAMPLES - 1) * STEP_MIN * MINUTE_MS;
export const REPLAY_SPEEDS = [60, 300, 900];

const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
const initialScenario = scenarioById(params.get("scenario") ?? "") ?? scenarios[0];

/** `?time=14:12` sets the initial demo time (site-local). */
function initialCursor(minuteDefault: number) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(params.get("time") ?? "");
  const minute = m ? Number(m[1]) * 60 + Number(m[2]) : minuteDefault;
  return DAY_START + minute * MINUTE_MS;
}

let state: OperatingContext = {
  scenarioId: initialScenario.id,
  cursor: initialCursor(initialScenario.defaultMinute),
  mode: params.get("mode") === "live" ? "live" : "replay",
  playing: false,
  speed: REPLAY_SPEEDS[0],
  selectedId: null,
  highlightIds: [],
  assistant: { open: false, conversationId: null, request: null },
};
const listeners = new Set<() => void>();

function set(patch: Partial<OperatingContext>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
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
  select: (id: string | null) => set({ selectedId: id }),
  highlight: (ids: string[]) => set({ highlightIds: ids }),
  openAssistant: (open = true) => set({ assistant: { ...state.assistant, open } }),
  showConversation: (conversationId: string | null) => set({ assistant: { ...state.assistant, conversationId } }),
  /** Open the drawer and ask a question in a new conversation with this context. */
  askAssistant: (prompt: string, equipmentId: string | null = null) =>
    set({ assistant: { open: true, conversationId: null, request: { prompt, equipmentId, nonce: Date.now() } } }),
  clearAssistantRequest: () => set({ assistant: { ...state.assistant, request: null } }),
  /** Advance the demo clock by `wallMs` of wall time. Called by the shell's ticker. */
  tick(wallMs: number) {
    if (!state.playing) return;
    const step = state.mode === "live" ? wallMs : wallMs * state.speed;
    const next = clampTime(state.cursor + step);
    set({ cursor: next, playing: next < DAY_END });
  },
};
