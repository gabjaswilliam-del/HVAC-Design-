/**
 * What the AI display holds: the items the assistant showed in this tab, newest last, and
 * the one on screen. The newest item replaces what is shown; earlier ones stay one step
 * away. Kept outside React so it survives screen changes, and in session storage so a
 * refresh keeps it (an item too large to store lasts until the page is reloaded).
 */
import { useSyncExternalStore } from "react";
import { displayItem, type DisplayItem } from "../../lib/contracts/display";

export interface DisplayState {
  items: DisplayItem[];
  shownId: string | null;
}

const KEY = "hvac-agent.ai-display.v1";
const KEEP = 20;

function load(): DisplayState {
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as DisplayState | null;
    // Stored items are read back through the same schema as streamed ones.
    const items = (raw?.items ?? []).filter((x) => displayItem.safeParse(x).success);
    return { items, shownId: items.some((x) => x.id === raw?.shownId) ? raw!.shownId : (items.at(-1)?.id ?? null) };
  } catch {
    return { items: [], shownId: null };
  }
}

let state: DisplayState = load();
const listeners = new Set<() => void>();
function set(next: DisplayState) {
  state = next;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Too large or blocked: kept in memory only.
  }
  listeners.forEach((l) => l());
}

export const useDisplay = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );

export const display = {
  current: () => state,
  /** Show a new item (an item already held is shown again, not added twice). */
  show(item: DisplayItem) {
    const items = state.items.some((x) => x.id === item.id) ? state.items : [...state.items, item].slice(-KEEP);
    set({ items, shownId: item.id });
  },
  select: (id: string) => state.items.some((x) => x.id === id) && set({ ...state, shownId: id }),
  clear: () => set({ items: [], shownId: null }),
};
