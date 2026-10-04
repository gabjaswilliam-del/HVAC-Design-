/**
 * The one browser-to-DGX data interface. Today only the explicitly selected demo
 * fixture adapter implements it; a local API adapter will implement the same methods.
 * Operation names are logical capabilities, not existing endpoints.
 */
import type { ZodType } from "zod";
import type {
  DemandHistory,
  ForecastResult,
  History,
  IssueList,
  SiteBundle,
  Snapshot,
} from "../contracts";

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface DataClient {
  readonly mode: "demo";
  getSite(o?: RequestOptions): Promise<SiteBundle>;
  getSnapshot(q: { at: string }, o?: RequestOptions): Promise<Snapshot>;
  getHistory(q: { metrics: string[]; from: string; to: string }, o?: RequestOptions): Promise<History>;
  getIssues(q: { at: string }, o?: RequestOptions): Promise<IssueList>;
  /** Latest issued forecast at or before `at`. Reading never starts inference. */
  getLatestForecast(
    q: { at: string; horizonMinutes: number; stepMinutes: number },
    o?: RequestOptions,
  ): Promise<ForecastResult>;
  getDemandHistory(q: { from: string; to: string }, o?: RequestOptions): Promise<DemandHistory>;
}

export type ErrorCode =
  | "TIMEOUT"
  | "UNAVAILABLE"
  | "PERMISSION_DENIED"
  | "MALFORMED_RESPONSE"
  | "ABORTED";

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Validate a payload at the boundary; a schema mismatch is an integration error. */
export function validate<T>(schema: ZodType<T>, payload: unknown, what: string): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ApiError(
      "MALFORMED_RESPONSE",
      `The ${what} response did not match the expected format (${first?.path.join(".") || "root"}: ${first?.message}).`,
      false,
    );
  }
  return parsed.data;
}

export const isAbort = (e: unknown) => e instanceof ApiError && e.code === "ABORTED";
