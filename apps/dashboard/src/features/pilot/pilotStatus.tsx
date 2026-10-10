import { Activity, CircleDashed, CircleSlash, CircleStop, Flag, LoaderCircle, Pause, Search, Unplug, type LucideIcon } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { isFinal } from "../../lib/contracts/simulation";
import type { SimulationSession } from "../simulation/simulationSession";

export type PilotStatus = "loading" | "no_backend" | "no_run" | "disconnected" | "ended" | "off" | "waiting" | "investigating" | "monitoring";

/** The pilot's state as the operator sees it, from what the services last reported. */
export function pilotStatusOf(sim: SimulationSession): PilotStatus {
  if (!sim.caps) return sim.capsError ? "no_backend" : "loading";
  if (!sim.caps.pilot.available) return "no_backend";
  if (!sim.runId) return "no_run";
  if (sim.readError || sim.pilotError) return "disconnected";
  if (!sim.run) return "loading";
  if (isFinal(sim.run.state)) return "ended";
  if (!sim.pilot?.monitoring) return "off";
  if (sim.run.state !== "running") return "waiting";
  return sim.pilot.reasoningPending ? "investigating" : "monitoring";
}

const ICONS: Record<PilotStatus, LucideIcon> = {
  loading: LoaderCircle,
  no_backend: CircleSlash,
  no_run: CircleDashed,
  disconnected: Unplug,
  ended: Flag,
  off: CircleStop,
  waiting: Pause,
  investigating: Search,
  monitoring: Activity,
};

export function PilotStatusLabel({ status }: { status: PilotStatus }) {
  const p = useStrings().pilot;
  const Icon = ICONS[status];
  return (
    <span className={`state-label pilot-status pilot-status--${status}`} data-pilot-status={status}>
      <Icon size={14} aria-hidden="true" />
      {p.status[status]}
    </span>
  );
}
