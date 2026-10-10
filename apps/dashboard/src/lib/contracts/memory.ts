/**
 * Graph Memory wire contract (the local memory service, `/api/memory/v1`, and the demo
 * records). Mirrors `src/hvac_agent/agent/memory.py`. Separate from the knowledge
 * contract: no type here refers to documents or passages. Memory text is untrusted data.
 */
import { z } from "zod";

export const MEMORY_KINDS = ["event", "observation", "finding", "decision", "correction", "outcome"] as const;
export const PROVENANCE = ["simulation", "demo", "user_entered", "imported_record", "verified_operational_source"] as const;
export const LINK_TYPES = ["RESULTED_IN", "RESOLVED_BY", "SUPPORTED_BY"] as const;
export const MEMORY_EDGES = ["OCCURRED_BEFORE", "RELATES_TO", "RESULTED_IN", "RESOLVED_BY", "SUPERSEDES", "SUPPORTED_BY", "PART_OF_RUN"] as const;
export const MEMORY_NODE_TYPES = [...MEMORY_KINDS, "equipment", "simulation_run"] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number];
export type Provenance = (typeof PROVENANCE)[number];
export type LinkType = (typeof LINK_TYPES)[number];
export type MemoryEdgeType = (typeof MEMORY_EDGES)[number];
export type MemoryNodeType = (typeof MEMORY_NODE_TYPES)[number];

export const memoryRecord = z.object({
  id: z.string(),
  kind: z.enum(MEMORY_KINDS),
  title: z.string(),
  body: z.string(),
  provenance: z.enum(PROVENANCE),
  sourceRef: z.string().nullable(),
  runId: z.string().nullable(),
  equipment: z.array(z.string()),
  occurredAt: z.string(),
  recordedAt: z.string(),
  validUntil: z.string().nullable(),
  status: z.enum(["current", "superseded"]),
  supersedes: z.string().nullable(),
  supersededBy: z.string().nullable(),
  correctionReason: z.string().nullable(),
});

export const memoryDetail = z.object({
  memory: memoryRecord,
  links: z.array(
    z.object({
      id: z.string(),
      type: z.enum(LINK_TYPES),
      direction: z.enum(["out", "in"]),
      other: memoryRecord.nullable(),
      createdAt: z.string(),
    }),
  ),
  history: z.array(memoryRecord),
});

export const memoryList = z.object({
  memories: z.array(memoryRecord),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  searched: z.boolean(),
});

const window = z.object({ from: z.string().nullable(), to: z.string().nullable() });
export const memoryTimeline = z.object({
  entries: z.array(memoryRecord.extend({ previous: z.record(z.string(), z.string()) })),
  total: z.number(),
  window,
});

export const memoryNode = z.object({
  id: z.string(),
  type: z.enum(MEMORY_NODE_TYPES),
  label: z.string(),
  occurredAt: z.string().optional(),
  provenance: z.enum(PROVENANCE).optional(),
  status: z.enum(["current", "superseded"]).optional(),
  equipment: z.array(z.string()).optional(),
  runId: z.string().nullable().optional(),
});
export const memoryEdge = z.object({
  id: z.string(),
  type: z.enum(MEMORY_EDGES),
  source: z.string(),
  target: z.string(),
  derived: z.boolean().optional(),
  equipment: z.string().optional(),
});
export const memoryGraph = z.object({
  nodes: z.array(memoryNode),
  edges: z.array(memoryEdge),
  total: z.number(),
  truncated: z.boolean(),
  limit: z.number(),
  window,
});
export const memoryNeighbourhood = z.object({
  nodes: z.array(memoryNode),
  edges: z.array(memoryEdge),
  focus: z.string(),
  total: z.number(),
  hasMore: z.boolean(),
});

export const memoryStatus = z.object({
  service: z.literal("memory"),
  storage: z.object({ engine: z.string(), persistent: z.boolean(), namespace: z.string() }),
  kinds: z.array(z.string()),
  provenance: z.array(z.object({ id: z.enum(PROVENANCE), allowed: z.boolean(), reason: z.string().optional() })),
  linkTypes: z.record(z.string(), z.object({ from: z.array(z.string()), to: z.array(z.string()), targetNotEarlier: z.boolean() })),
  limits: z.record(z.string(), z.number()),
  retention: z.string(),
  totals: z.record(z.string(), z.number()),
});

export const memoryDeleted = z.object({
  deleted: z.string(),
  removedLinks: z.number(),
  restored: z.string().nullable(),
  newerVersion: z.string().nullable(),
});

export type MemoryRecord = z.infer<typeof memoryRecord>;
export type MemoryDetail = z.infer<typeof memoryDetail>;
export type MemoryList = z.infer<typeof memoryList>;
export type MemoryTimeline = z.infer<typeof memoryTimeline>;
export type MemoryNode = z.infer<typeof memoryNode>;
export type MemoryEdge = z.infer<typeof memoryEdge>;
export type MemoryGraph = z.infer<typeof memoryGraph>;
export type MemoryNeighbourhood = z.infer<typeof memoryNeighbourhood>;
export type MemoryStatus = z.infer<typeof memoryStatus>;
export type MemoryDeleted = z.infer<typeof memoryDeleted>;

/** Filters shared by the list, timeline and graph. Times are ISO 8601 with a zone. */
export interface MemoryFilters {
  query?: string;
  kinds?: MemoryKind[];
  provenance?: Provenance[];
  equipment?: string[];
  from?: string;
  to?: string;
  includeSuperseded?: boolean;
  limit?: number;
}

export type MemoryLinkDraft = { type: LinkType; source: string } | { type: LinkType; target: string };

export interface MemoryDraft {
  kind: MemoryKind;
  title: string;
  body?: string;
  provenance: Provenance;
  sourceRef?: string;
  runId?: string;
  equipment?: string[];
  occurredAt: string;
  links?: MemoryLinkDraft[];
}

export interface MemoryCorrection extends Partial<Omit<MemoryDraft, "kind" | "links">> {
  reason: string;
}
