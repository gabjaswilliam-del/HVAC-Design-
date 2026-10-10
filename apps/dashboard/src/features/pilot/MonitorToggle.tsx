import { Activity, CircleStop } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { isFinal } from "../../lib/contracts/simulation";
import { simulationSession, useSimulation } from "../simulation";

/**
 * Pauses or resumes the pilot's monitoring of the run AI Pilot shows, and only when the
 * service advertises a pilot. Monitoring starts with the run; this is the secondary
 * control for watching a run without the pilot (the simulation keeps running either way).
 */
export function MonitorToggle() {
  const p = useStrings().pilot;
  const sim = useSimulation();
  const run = sim.run && sim.run.runId === sim.runId ? sim.run : null;
  if (!run || !sim.caps?.pilot.available || !sim.pilot || isFinal(run.state) || sim.readError) return null;
  const on = sim.pilot.monitoring;
  const busy = Boolean(sim.busy);
  return (
    <button
      type="button"
      className="button button--small"
      aria-disabled={busy || undefined}
      aria-busy={sim.busy === "monitor" || undefined}
      title={on ? undefined : p.monitorNote}
      data-pilot-control="monitoring"
      onClick={() => !busy && void simulationSession.setMonitoring(run.runId, !on)}
    >
      {on ? <CircleStop size={14} aria-hidden="true" /> : <Activity size={14} aria-hidden="true" />}
      {on ? p.pauseMonitoring : sim.pilot.scans > 0 ? p.resumeMonitoring : p.monitor(run.runId)}
    </button>
  );
}
