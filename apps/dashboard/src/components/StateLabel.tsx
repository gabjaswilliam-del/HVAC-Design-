import { CircleHelp, CircleStop, Clock, Play, TriangleAlert } from "lucide-react";
import type { OperatingState } from "../lib/contracts";
import { useStrings } from "../lib/i18n";

const ICONS = { running: Play, stopped: CircleStop, fault: TriangleAlert, unavailable: CircleHelp, stale: Clock };

/** Equipment state as icon + word; colour is a secondary cue only. */
export function StateLabel({ state, stale = false }: { state: OperatingState; stale?: boolean }) {
  const s = useStrings();
  const key = stale ? "stale" : state;
  const Icon = ICONS[key];
  return (
    <span className={`state-label state-label--${key}`}>
      <Icon size={14} aria-hidden="true" />
      {s.scene.states[key]}
    </span>
  );
}
