/**
 * The prediction the Cooling prediction page is showing: made with Predict at a moment on
 * the playback clock (or opened from a forecast link), and kept while the operator goes to
 * other screens and plays the plant, so the actual cooling load can be logged against it.
 * Remembered in this tab; it belongs to one demo scenario.
 */
import { useSyncExternalStore } from "react";
import type { ForecastResult } from "../../lib/contracts";

export interface Prediction {
  scenarioId: string;
  forecast: ForecastResult;
  /** Opened from a forecast link rather than made with Predict. */
  linked: boolean;
}

const KEY = "hvac-agent.prediction.v1";
function load(): Prediction | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Prediction) : null;
  } catch {
    return null;
  }
}

let state: Prediction | null = load();
const listeners = new Set<() => void>();
function set(next: Prediction | null) {
  state = next;
  try {
    if (next) sessionStorage.setItem(KEY, JSON.stringify(next));
    else sessionStorage.removeItem(KEY);
  } catch {
    // Not remembered; it lasts until the page is reloaded.
  }
  listeners.forEach((l) => l());
}

export const usePrediction = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );

export const prediction = {
  set: (p: Prediction) => set(p),
  clear: () => set(null),
};
