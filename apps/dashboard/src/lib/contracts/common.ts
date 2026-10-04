/**
 * Shared boundary primitives. Draft frontend schemas derived from
 * docs/ui-data-contracts.md; the canonical wire schema is still to be agreed with the
 * API owner, after which these should be generated from it.
 */
import { z } from "zod";

/** Timezone-aware ISO 8601 timestamp (UTC on the wire). */
export const isoTime = z.iso.datetime({ offset: true });

export const quality = z.enum(["good", "stale", "unavailable"]);
export type Quality = z.infer<typeof quality>;

export const operatingState = z.enum(["running", "stopped", "fault", "unavailable"]);
export type OperatingState = z.infer<typeof operatingState>;

export const evidence = z.enum(["confirmed", "drawing", "inferred", "unknown"]);
export type Evidence = z.infer<typeof evidence>;

/** Observation source. Demo/fixture is a client mode, never a third source kind. */
export const source = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("telemetry") }),
  z.object({ kind: z.literal("simulation"), runId: z.string().min(1) }),
]);
export type Source = z.infer<typeof source>;

export const apiError = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  fieldErrors: z.record(z.string(), z.string()).optional(),
  correlationId: z.string().optional(),
});
export type ApiErrorBody = z.infer<typeof apiError>;
