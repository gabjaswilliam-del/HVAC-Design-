/**
 * Browser side of the simulation service and the AI pilot. Today the explicitly selected
 * demo mode implements both with a labelled mock service; the modified-PHYVAC service
 * behind the local API will implement the same methods. Operation names are logical
 * capabilities, not existing endpoints.
 *
 * Every operation addresses one simulation run by its ID. Nothing here can reach
 * physical equipment.
 */
import type {
  Correction,
  CorrectionRequest,
  PilotState,
  RunCommand,
  RunConfig,
  RunDetail,
  RunStatus,
  RunSummary,
  SimulationCapabilities,
} from "../contracts/simulation";
import type { Snapshot } from "../contracts";
import type { RequestOptions } from "./client";

export interface SimulationClient {
  getCapabilities(o?: RequestOptions): Promise<SimulationCapabilities>;
  listRuns(o?: RequestOptions): Promise<RunStatus[]>;
  /** Reading a run never advances its clock. */
  getRun(runId: string, o?: RequestOptions): Promise<RunDetail>;
  /** The observation a run recorded at step `step` (0 is the initial one), for replay.
   *  NOT_FOUND for a step the run has not recorded. */
  getObservation(runId: string, step: number, o?: RequestOptions): Promise<Snapshot>;
  /** Idempotent per `requestId`: a repeated request returns the run it already created.
   *  `name` is the operator's label; the service names the run if it is left out. */
  createRun(config: RunConfig, requestId: string, name?: string): Promise<RunStatus>;
  /** Rename a run: its label only, never its identity, configuration or state. */
  renameRun(runId: string, name: string): Promise<RunStatus>;
  /** A backend lifecycle operation; the returned status is the run's own. */
  command(runId: string, command: RunCommand): Promise<RunStatus>;
  /** Pass a correction to the run's gate. A rejection is an answer, not an error. */
  submitCorrection(runId: string, request: CorrectionRequest): Promise<Correction>;
}

export interface PilotClient {
  getState(runId: string, o?: RequestOptions): Promise<PilotState>;
  /** Monitoring is enabled for one explicitly named run only. */
  setMonitoring(runId: string, monitoring: boolean): Promise<PilotState>;
  /** The operator declines an issue's standing proposal: nothing is applied, and it is
   *  recorded as the operator's decision. (Applying goes through the run's correction gate.) */
  declineProposal(runId: string, issueId: string): Promise<PilotState>;
  /** The pilot's summary of a run that has ended (CONFLICT while it is still active). */
  getRunSummary(runId: string, o?: RequestOptions): Promise<RunSummary>;
  /** Summaries of every ended run, newest first. */
  listRunSummaries(o?: RequestOptions): Promise<RunSummary[]>;
}

/** What the assistant may use: reads only. No command, correction or monitoring switch
 *  is reachable through these (F10). */
export type SimulationReader = Pick<SimulationClient, "getCapabilities" | "listRuns" | "getRun">;
export type PilotReader = Pick<PilotClient, "getState" | "getRunSummary" | "listRunSummaries">;
export const simulationReader = (c: SimulationClient): SimulationReader => ({
  getCapabilities: (o) => c.getCapabilities(o),
  listRuns: (o) => c.listRuns(o),
  getRun: (id, o) => c.getRun(id, o),
});
export const pilotReader = (c: PilotClient): PilotReader => ({
  getState: (id, o) => c.getState(id, o),
  getRunSummary: (id, o) => c.getRunSummary(id, o),
  listRunSummaries: (o) => c.listRunSummaries(o),
});
