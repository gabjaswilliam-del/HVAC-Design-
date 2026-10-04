/**
 * Site-wide data hooks shared by every screen: the site bundle (loaded once per data
 * context), and readings/issues for the current playback time. All go through the
 * one DataClient; changing scenario discards results from the old one.
 */
import { createContext, useContext, type ReactNode } from "react";
import type { IssueList, SiteBundle, Snapshot } from "../lib/contracts";
import { useResource, type Resource } from "../lib/api/useResource";
import { DAY_START, MINUTE_MS, sampleIndexAt, STEP_MIN } from "../fixtures/generate";
import { useDataClient } from "./dataClient";
import { useOperating } from "./operatingContext";

const SiteContext = createContext<Resource<SiteBundle> | null>(null);

export function SiteProvider({ children }: { children: ReactNode }) {
  const client = useDataClient();
  const scenarioId = useOperating((s) => s.scenarioId);
  const site = useResource("site", scenarioId, (signal) => client.getSite({ signal }));
  return <SiteContext.Provider value={site}>{children}</SiteContext.Provider>;
}

export const useSite = () => useContext(SiteContext)!;

/** Readings are sampled every STEP_MIN minutes; request per sample, not per tick. */
function useSampleTime() {
  const cursor = useOperating((s) => s.cursor);
  return new Date(DAY_START + sampleIndexAt(cursor) * STEP_MIN * MINUTE_MS).toISOString();
}

export function useSnapshot(): Resource<Snapshot> & { at: string } {
  const client = useDataClient();
  const scenarioId = useOperating((s) => s.scenarioId);
  const at = useSampleTime();
  return { ...useResource(`snapshot:${at}`, scenarioId, (signal) => client.getSnapshot({ at }, { signal })), at };
}

export function useIssues(): Resource<IssueList> {
  const client = useDataClient();
  const scenarioId = useOperating((s) => s.scenarioId);
  const at = useSampleTime();
  return useResource(`issues:${at}`, scenarioId, (signal) => client.getIssues({ at }, { signal }));
}
