/**
 * KnowledgeService client (Graph RAG). Two implementations: the local knowledge service
 * over HTTP (persistent, the real path) and the demo snapshot in `src/fixtures`. The
 * screens see only this interface; which one runs is chosen once, in `app/dataClient.ts`.
 */
import type { RequestOptions } from "./client";
import { localService } from "./local";
import {
  deleteResult,
  documentDetail,
  documentList,
  edgeDetail,
  knowledgeGraph,
  knowledgeStatus,
  nodeDetail,
  passage,
  searchResult,
  type DeleteResult,
  type DocumentDetail,
  type DocumentList,
  type DocumentUpload,
  type EdgeDetail,
  type EdgeType,
  type KnowledgeGraph,
  type KnowledgeStatus,
  type NodeDetail,
  type NodeType,
  type Passage,
  type SearchResult,
} from "../contracts/knowledge";

export interface GraphQuery {
  types?: readonly NodeType[];
  edgeTypes?: readonly EdgeType[];
  limit?: number;
  document?: string;
}

export interface KnowledgeClient {
  /** "demo": the fixed synthetic library, read only. "local": the local service. */
  readonly mode: "demo" | "local";
  status(o?: RequestOptions): Promise<KnowledgeStatus>;
  listDocuments(o?: RequestOptions): Promise<DocumentList>;
  getDocument(id: string, o?: RequestOptions): Promise<DocumentDetail>;
  /** Accepted documents are queued; poll getDocument for the job's stages. */
  ingestDocument(upload: DocumentUpload, o?: RequestOptions): Promise<DocumentDetail>;
  reindexDocument(id: string, o?: RequestOptions): Promise<DocumentDetail>;
  deleteDocument(id: string, o?: RequestOptions): Promise<DeleteResult>;
  searchKnowledge(q: { query: string; limit?: number }, o?: RequestOptions): Promise<SearchResult>;
  getKnowledgeGraph(q?: GraphQuery, o?: RequestOptions): Promise<KnowledgeGraph>;
  /** A node, its neighbours (bounded) and where an entity is mentioned. */
  expandKnowledgeNode(id: string, q?: { limit?: number; edgeTypes?: readonly EdgeType[] }, o?: RequestOptions): Promise<NodeDetail>;
  /** The source passages behind one relationship. */
  inspectEvidence(edgeId: string, o?: RequestOptions): Promise<EdgeDetail>;
  getPassage(chunkId: string, o?: RequestOptions): Promise<Passage>;
}

export function httpKnowledge(base = "/api/knowledge/v1", fetchImpl?: typeof fetch): KnowledgeClient {
  const req = localService(base, "knowledge", fetchImpl);
  const id = encodeURIComponent;
  return {
    mode: "local",
    status: (o) => req(knowledgeStatus, "/status", {}, o),
    listDocuments: (o) => req(documentList, "/documents", {}, o),
    getDocument: (d, o) => req(documentDetail, `/documents/${id(d)}`, {}, o),
    ingestDocument: (upload, o) => req(documentDetail, "/documents", { method: "POST", body: upload }, o),
    reindexDocument: (d, o) => req(documentDetail, `/documents/${id(d)}/reindex`, { method: "POST", body: {} }, o),
    deleteDocument: (d, o) => req(deleteResult, `/documents/${id(d)}`, { method: "DELETE" }, o),
    searchKnowledge: (q, o) => req(searchResult, "/search", { method: "POST", body: q }, o),
    getKnowledgeGraph: (q = {}, o) =>
      req(knowledgeGraph, "/graph", { query: { types: q.types, edgeTypes: q.edgeTypes, limit: q.limit, document: q.document } }, o),
    expandKnowledgeNode: (n, q = {}, o) => req(nodeDetail, `/graph/nodes/${id(n)}`, { query: { limit: q.limit, edgeTypes: q.edgeTypes } }, o),
    inspectEvidence: (e, o) => req(edgeDetail, `/graph/edges/${id(e)}`, {}, o),
    getPassage: (c, o) => req(passage, `/chunks/${id(c)}`, {}, o),
  };
}
