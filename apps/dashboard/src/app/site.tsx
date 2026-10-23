/**
 * Site-wide data shared by every screen: the site bundle (loaded once per data
 * context), and readings/issues for the current playback time. Each is loaded once
 * here and shared, so the header, the page and Details always show the same sample.
 * All go through the one DataClient; changing scenario discards results from the old one.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { IssueList, SiteBundle, Snapshot } from "../lib/contracts";
import type { AgentContext } from "../lib/contracts/agent";
import { scenarioById } from "../fixtures/scenarios";
import { useResource, type Resource } from "../lib/api/useResource";
import { DAY_START, MINUTE_MS, sampleIndexAt, STEP_MIN } from "../fixtures/generate";
import { useDataClient } from "./dataClient";
import { useOperating } from "./operatingContext";

interface SiteData {
  site: Resource<SiteBundle>;
  snapshot: Resource<Snapshot> & { at: string };
  issues: Resource<IssueList>;
}

const SiteContext = createContext<SiteData | null>(null);

/** Readings are sampled every STEP_MIN minutes; request per sample, not per tick. */
function useSampleTime() {
  // Subscribe to the sample, not the clock, so a playing clock re-renders once per sample.
  const sample = useOperating((s) => sampleIndexAt(s.cursor));
  return new Date(DAY_START + sample * STEP_MIN * MINUTE_MS).toISOString();
}

export function SiteProvider({ children }: { children: ReactNode }) {
  const client = useDataClient();
  const scenarioId = useOperating((s) => s.scenarioId);
  const at = useSampleTime();
  const site = useResource("site", scenarioId, (signal) => client.getSite({ signal }));
  const snapshot = useResource(`snapshot:${at}`, scenarioId, (signal) => client.getSnapshot({ at }, { signal }));
  const issues = useResource(`issues:${at}`, scenarioId, (signal) => client.getIssues({ at }, { signal }));
  return <SiteContext.Provider value={{ site, snapshot: { ...snapshot, at }, issues }}>{children}</SiteContext.Provider>;
}

export const useSite = () => useContext(SiteContext)!.site;
export const useSnapshot = (): Resource<Snapshot> & { at: string } => useContext(SiteContext)!.snapshot;

/** The plant at rest: equipment the data reports running is shown stopped. Nothing else
 *  changes (readings, faults and stale data stay as reported). */
export function plantAtRest(snap: Snapshot): Snapshot {
  return {
    ...snap,
    equipment: Object.fromEntries(Object.entries(snap.equipment).map(([id, e]) => [id, e.state === "running" ? { ...e, state: "stopped" as const } : e])),
  };
}

/**
 * The plant as the Overview and Details show it: it runs only while the simulation plays
 * (the deck's Run simulation). Paused, running equipment is shown stopped, so nothing
 * turns or flows on the drawing. Records, trends and the top bar's readings keep the
 * reported data.
 */
export function usePlantSnapshot(): Resource<Snapshot> & { at: string } {
  const snapshot = useSnapshot();
  const playing = useOperating((s) => s.playing);
  const data = useMemo(() => (snapshot.data && !playing ? plantAtRest(snapshot.data) : snapshot.data), [snapshot.data, playing]);
  return { ...snapshot, data };
}
export const useIssues = (): Resource<IssueList> => useContext(SiteContext)!.issues;

/** Context a new assistant conversation is asked in: current source, time and selection. */
export function useAgentContext(): (equipmentId?: string | null) => AgentContext | null {
  const site = useSite();
  const scenarioId = useOperating((s) => s.scenarioId);
  const selectedId = useOperating((s) => s.selectedId);
  const at = useSampleTime();
  return (equipmentId) =>
    site.data
      ? {
          source: "telemetry",
          configRevision: site.data.topology.configRevision,
          at,
          equipmentId: equipmentId === undefined ? selectedId : equipmentId,
          demoScenario: { id: scenarioId, label: scenarioById(scenarioId)?.label ?? scenarioId },
        }
      : null;
}
