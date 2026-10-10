/**
 * Graph RAG wire contract (the local knowledge service, `/api/knowledge/v1`, and the demo
 * snapshot). Mirrors `src/hvac_agent/knowledge/service.py`. Retrieved text is untrusted
 * data: it is displayed as text and never interpreted.
 */
import { z } from "zod";

export const NODE_TYPES = ["document", "section", "equipment", "component", "fault", "symptom", "procedure", "standard", "concept"] as const;
export const EDGE_TYPES = ["DOCUMENTS", "PART_OF", "CONNECTED_TO", "ASSOCIATED_WITH", "DESCRIBED_BY", "REFERENCES", "ADDRESSES"] as const;
export const STAGES = ["validate", "extract", "chunk", "embed", "entities", "relations", "graph", "search"] as const;
export const DOCUMENT_STATUS = ["queued", "processing", "ready", "partial", "failed"] as const;
export const DOCUMENT_KINDS = ["manual", "standard", "procedure", "equipment", "reference"] as const;

export type NodeType = (typeof NODE_TYPES)[number];
export type EdgeType = (typeof EDGE_TYPES)[number];
export type DocumentStatus = (typeof DOCUMENT_STATUS)[number];

const stage = z.object({
  name: z.enum(STAGES),
  status: z.enum(["pending", "running", "done", "skipped", "failed"]),
  detail: z.string().nullable(),
  at: z.string().nullable(),
});

export const documentSummary = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string(),
  mediaType: z.string(),
  sizeBytes: z.number(),
  kind: z.string(),
  metadata: z.object({
    equipment: z.array(z.string()),
    publisher: z.string().nullable().optional(),
    revisionLabel: z.string().nullable().optional(),
    titleSource: z.string().optional(),
  }),
  sha256: z.string(),
  revision: z.number(),
  status: z.enum(DOCUMENT_STATUS),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  indexedAt: z.string().nullable(),
  pipeline: z.string().nullable(),
  sectionCount: z.number(),
  chunkCount: z.number(),
  stages: z.array(stage),
});

export const documentDetail = documentSummary.extend({
  outline: z.array(
    z.object({
      id: z.string(),
      heading: z.string(),
      level: z.number(),
      parentId: z.string().nullable(),
      path: z.string(),
      page: z.number().nullable(),
      procedure: z.boolean(),
      chunkCount: z.number(),
      firstChunk: z.string().nullable(),
    }),
  ),
  firstChunk: z.string().nullable(),
});

const totals = z.record(z.string(), z.number());
export const documentList = z.object({ documents: z.array(documentSummary), totals });
export const deleteResult = z.object({ deleted: z.string(), removed: totals });

const capability = z.object({ available: z.boolean(), reason: z.string().optional(), model: z.string().optional() });
export const knowledgeStatus = z.object({
  service: z.literal("knowledge"),
  storage: z.object({ engine: z.string(), persistent: z.boolean(), namespace: z.string() }),
  pipeline: z.string(),
  formats: z.array(z.object({ mediaType: z.string(), extensions: z.array(z.string()), available: z.boolean(), reason: z.string().optional() })),
  maxBytes: z.number(),
  kinds: z.array(z.string()),
  extraction: z.object({ method: z.string(), vocabulary: z.string(), entityTypes: z.array(z.string()), model: capability }),
  embeddings: capability,
  vectorModels: z.array(z.object({ model: z.string(), n: z.number() })),
  answers: capability,
  totals,
});

export const graphNode = z.object({
  id: z.string(),
  type: z.enum(NODE_TYPES),
  label: z.string(),
  degree: z.number(),
  documentId: z.string().nullable(),
});
export const graphEdge = z.object({ id: z.string(), type: z.enum(EDGE_TYPES), source: z.string(), target: z.string(), evidence: z.number() });
export const knowledgeGraph = z.object({
  nodes: z.array(graphNode),
  edges: z.array(graphEdge),
  total: z.number(),
  truncated: z.boolean(),
  limit: z.number(),
});

const snippet = z
  .object({ text: z.string(), highlight: z.tuple([z.number(), z.number()]), before: z.boolean(), after: z.boolean() })
  .nullable();
export const evidenceItem = z.object({
  documentId: z.string(),
  documentTitle: z.string(),
  revision: z.number(),
  chunkId: z.string().nullable(),
  sectionPath: z.string().nullable(),
  page: z.number().nullable(),
  rule: z.string(),
  snippet,
});
const evidenceList = z.object({ total: z.number(), items: z.array(evidenceItem) });

export const nodeDetail = z.object({
  node: graphNode,
  neighbours: z.object({ nodes: z.array(graphNode), edges: z.array(graphEdge), hasMore: z.boolean() }),
  section: z
    .object({
      documentId: z.string(),
      documentTitle: z.string(),
      path: z.string(),
      page: z.number().nullable(),
      procedure: z.boolean(),
      firstChunk: z.string().nullable(),
    })
    .optional(),
  document: documentSummary.optional(),
  mentions: evidenceList.optional(),
});
export const edgeDetail = z.object({ edge: graphEdge, source: graphNode.nullable(), target: graphNode.nullable(), evidence: evidenceList });

const entityRef = z.object({ id: z.string(), type: z.string(), name: z.string() });
export const passage = z.object({
  chunkId: z.string(),
  documentId: z.string(),
  documentTitle: z.string(),
  documentName: z.string(),
  revision: z.number(),
  sectionId: z.string(),
  sectionPath: z.string(),
  page: z.number().nullable(),
  ordinal: z.number(),
  text: z.string(),
  mentions: z.array(z.object({ entityId: z.string(), start: z.number(), end: z.number() })),
  entities: z.array(entityRef),
  previous: z.string().nullable(),
  next: z.string().nullable(),
  indexedAt: z.string().nullable(),
});

const path = z.object({
  start: z.string(),
  relation: z.string(),
  end: z.string().nullable(),
  relationId: z.string().optional(),
  direction: z.string().optional(),
});
const methodHit = z.object({
  method: z.enum(["keyword", "graph", "vector"]),
  rank: z.number(),
  bm25: z.number().optional(),
  similarity: z.number().optional(),
  paths: z.array(path).optional(),
});
export const searchResult = z.object({
  query: z.string(),
  results: z.array(
    z.object({
      rank: z.number(),
      chunkId: z.string(),
      documentId: z.string(),
      documentTitle: z.string(),
      documentName: z.string(),
      revision: z.number(),
      sectionId: z.string(),
      sectionPath: z.string(),
      page: z.number().nullable(),
      procedure: z.boolean(),
      text: z.string(),
      highlights: z.array(z.tuple([z.number(), z.number()])),
      fusionScore: z.number(),
      methods: z.array(methodHit),
      entities: z.array(entityRef),
      provenance: z.object({
        source: z.string(),
        mediaType: z.string(),
        kind: z.string(),
        indexedAt: z.string().nullable(),
        pipeline: z.string().nullable(),
        extraction: z.string(),
      }),
    }),
  ),
  documents: z.array(z.object({ id: z.string(), title: z.string(), passages: z.number() })),
  methods: z.object({
    keyword: z.object({ available: z.boolean(), used: z.boolean(), candidates: z.number() }),
    graph: z.object({
      available: z.boolean(),
      used: z.boolean(),
      candidates: z.number(),
      seeds: z.array(entityRef),
      unknownTerms: z.array(z.string()),
    }),
    vector: z.object({ available: z.boolean(), used: z.boolean(), reason: z.string().optional(), model: z.string().optional(), candidates: z.number().optional() }),
  }),
  names: z.record(z.string(), entityRef),
  fusion: z.object({ method: z.string(), k: z.number(), note: z.string() }),
  answer: capability,
});

export type KnowledgeStatus = z.infer<typeof knowledgeStatus>;
export type DocumentSummary = z.infer<typeof documentSummary>;
export type DocumentDetail = z.infer<typeof documentDetail>;
export type DocumentList = z.infer<typeof documentList>;
export type DeleteResult = z.infer<typeof deleteResult>;
export type GraphNode = z.infer<typeof graphNode>;
export type GraphEdge = z.infer<typeof graphEdge>;
export type KnowledgeGraph = z.infer<typeof knowledgeGraph>;
export type EvidenceItem = z.infer<typeof evidenceItem>;
export type NodeDetail = z.infer<typeof nodeDetail>;
export type EdgeDetail = z.infer<typeof edgeDetail>;
export type Passage = z.infer<typeof passage>;
export type SearchResult = z.infer<typeof searchResult>;
export type SearchHit = SearchResult["results"][number];

export interface DocumentUpload {
  name: string;
  contentBase64: string;
  kind: string;
  title?: string;
  equipment?: string[];
  publisher?: string;
  revisionLabel?: string;
}
