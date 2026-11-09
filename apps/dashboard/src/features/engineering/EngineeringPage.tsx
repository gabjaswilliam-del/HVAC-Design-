import { HistoryPage } from "../simulation";

/**
 * Engineering: only the simulation history and its replays. Each run in the table opens
 * its replay on the Simulation screen (`/simulation/:runId`); the live one is operated in
 * AI Pilot. The equipment records, investigations and CAD sections used to live here; the
 * record detail pages remain at `/equipment/:equipmentId`.
 */
export function EngineeringPage() {
  return <HistoryPage />;
}
