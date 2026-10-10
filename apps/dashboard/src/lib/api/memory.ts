/**
 * MemoryService client (Graph Memory), separate from the knowledge client: its own
 * service, path and contract. The local memory service is the persistent store; the demo
 * records are read only and never mixed with it.
 */
import type { RequestOptions } from "./client";
import { localService } from "./local";
import {
  memoryDeleted,
  memoryDetail,
  memoryGraph,
  memoryList,
  memoryNeighbourhood,
  memoryStatus,
  memoryTimeline,
  type LinkType,
  type MemoryCorrection,
  type MemoryDeleted,
  type MemoryDetail,
  type MemoryDraft,
  type MemoryFilters,
  type MemoryGraph,
  type MemoryList,
  type MemoryNeighbourhood,
  type MemoryStatus,
  type MemoryTimeline,
} from "../contracts/memory";

export interface MemoryClient {
  readonly mode: "demo" | "local";
  status(o?: RequestOptions): Promise<MemoryStatus>;
  createMemory(draft: MemoryDraft, o?: RequestOptions): Promise<MemoryDetail>;
  /** Records matching the filters, latest first; with a query, a keyword search. */
  listMemories(f?: MemoryFilters & { offset?: number }, o?: RequestOptions): Promise<MemoryList>;
  searchMemories(query: string, f?: MemoryFilters, o?: RequestOptions): Promise<MemoryList>;
  getMemoryTimeline(f?: MemoryFilters, o?: RequestOptions): Promise<MemoryTimeline>;
  getMemoryGraph(f?: MemoryFilters, o?: RequestOptions): Promise<MemoryGraph>;
  expandMemoryNode(id: string, q?: { includeSuperseded?: boolean; limit?: number }, o?: RequestOptions): Promise<MemoryNeighbourhood>;
  inspectMemory(id: string, o?: RequestOptions): Promise<MemoryDetail>;
  /** A correction: a new version; the old one stays as history. */
  supersedeMemory(id: string, correction: MemoryCorrection, o?: RequestOptions): Promise<MemoryDetail>;
  linkMemories(id: string, link: { type: LinkType; source: string } | { type: LinkType; target: string }, o?: RequestOptions): Promise<MemoryDetail>;
  unlinkMemories(id: string, linkId: string, o?: RequestOptions): Promise<MemoryDetail>;
  deleteMemory(id: string, o?: RequestOptions): Promise<MemoryDeleted>;
}

const query = (f: MemoryFilters & { offset?: number } = {}) => ({
  query: f.query,
  kinds: f.kinds,
  provenance: f.provenance,
  equipment: f.equipment,
  from: f.from,
  to: f.to,
  includeSuperseded: f.includeSuperseded ? "true" : undefined,
  limit: f.limit,
  offset: f.offset,
});

export function httpMemory(base = "/api/memory/v1", fetchImpl?: typeof fetch): MemoryClient {
  const req = localService(base, "memory", fetchImpl);
  const id = encodeURIComponent;
  return {
    mode: "local",
    status: (o) => req(memoryStatus, "/status", {}, o),
    createMemory: (draft, o) => req(memoryDetail, "/memories", { method: "POST", body: draft }, o),
    listMemories: (f, o) => req(memoryList, "/memories", { query: query(f) }, o),
    searchMemories: (q, f, o) => req(memoryList, "/memories", { query: query({ ...f, query: q }) }, o),
    getMemoryTimeline: (f, o) => req(memoryTimeline, "/timeline", { query: query(f) }, o),
    getMemoryGraph: (f, o) => req(memoryGraph, "/graph", { query: query(f) }, o),
    expandMemoryNode: (n, q = {}, o) =>
      req(memoryNeighbourhood, `/graph/nodes/${id(n)}`, { query: { includeSuperseded: q.includeSuperseded ? "true" : undefined, limit: q.limit } }, o),
    inspectMemory: (m, o) => req(memoryDetail, `/memories/${id(m)}`, {}, o),
    supersedeMemory: (m, c, o) => req(memoryDetail, `/memories/${id(m)}/supersede`, { method: "POST", body: c }, o),
    linkMemories: (m, link, o) => req(memoryDetail, `/memories/${id(m)}/links`, { method: "POST", body: link }, o),
    unlinkMemories: (m, l, o) => req(memoryDetail, `/memories/${id(m)}/links/${id(l)}`, { method: "DELETE" }, o),
    deleteMemory: (m, o) => req(memoryDeleted, `/memories/${id(m)}`, { method: "DELETE" }, o),
  };
}
