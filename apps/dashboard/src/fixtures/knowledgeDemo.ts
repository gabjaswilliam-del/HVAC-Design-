/**
 * The demo knowledge library: the synthetic documents in `fixtures/knowledge/`, indexed by
 * the real rule-based pipeline when the snapshot was made (`scripts/export_knowledge_demo.py`
 * writes `knowledgeDemo.json`; a Python test fails if it is stale). Read only: adding,
 * reindexing and removing documents needs the local knowledge service.
 *
 * Search runs here over the indexed passages with the service's method: keyword BM25, the
 * graph from the entities a question names, reciprocal rank fusion. The keyword ranking
 * approximates SQLite FTS5 (a lighter stemmer), so a demo ranking can differ slightly.
 * Nothing here is a live service or a model, and the screens say so.
 */
import { ApiError, type RequestOptions } from "../lib/api/client";
import type { KnowledgeClient } from "../lib/api/knowledge";
import type {
  DocumentDetail,
  EdgeDetail,
  EvidenceItem,
  GraphEdge,
  GraphNode,
  KnowledgeStatus,
  NodeDetail,
  Passage,
  SearchResult,
} from "../lib/contracts/knowledge";
import { delay } from "./fixtureClient";

interface Span {
  documentId: string;
  chunkId: string | null;
  start: number | null;
  end: number | null;
  rule?: string;
}
export interface KnowledgeSnapshot {
  status: KnowledgeStatus;
  documents: DocumentDetail[];
  graph: { nodes: GraphNode[]; edges: GraphEdge[]; total: number; truncated: boolean; limit: number };
  evidence: Record<string, Span[]>;
  mentions: Record<string, Span[]>;
  chunks: Record<string, Passage>;
  aliases: Record<string, string[]>;
}

const READ_ONLY = "The demo library is fixed. Adding, reindexing and removing documents needs the local knowledge service.";
const SEMANTIC = new Set(["ASSOCIATED_WITH", "PART_OF", "CONNECTED_TO", "ADDRESSES"]);
const STOP = new Set(
  "a an and are as at be by can do does for from has have how i in into is it its of on or that the their this to was what when where which who why will with about should could would there these those any all".split(" "),
);
// The service's procedure-heading words: a question about procedures prefers procedure sections.
const PROCEDURE = /\b(procedures?|inspections?|maintenance|cleaning|start-?up|shut-?down|commissioning|checklists?|troubleshooting|replacement|calibration|tests?|testing|steps)\b/i;
const CANDIDATES = 30;
const RRF_K = 60;

const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
/** A light suffix stemmer standing in for FTS5's Porter stemmer. */
export const stem = (w: string) => {
  for (const suffix of ["ations", "ation", "ings", "ing", "edly", "ed", "ies", "es", "s", "e", "ly"]) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 3) return suffix === "ies" ? `${w.slice(0, -3)}y` : w.slice(0, -suffix.length);
  }
  return w;
};
const aliasPattern = (alias: string) =>
  new RegExp(`(?<!\\w)${alias.split(/[\s-]+/).map((w) => w.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("[\\s-]+")}(?:e?s)?(?!\\w)`, "giu");

/** The evidence span inside its passage with context, as the service cuts it. */
export function snippet(text: string, start: number | null, end: number | null, context = 110): EvidenceItem["snippet"] {
  if (start === null || end === null) return null;
  const a = Math.max(0, start);
  const b = Math.min(text.length, end);
  let lo = Math.max(0, a - context);
  let hi = Math.min(text.length, b + context);
  if (lo > 0) {
    const space = text.indexOf(" ", lo); // start at a word, not inside one
    if (space !== -1 && space < a) lo = space + 1;
  }
  if (hi < text.length) {
    const space = text.lastIndexOf(" ", hi - 1); // end at a word, not inside one
    if (space >= b) hi = space;
  }
  return { text: text.slice(lo, hi), highlight: [a - lo, b - lo], before: lo > 0, after: hi < text.length };
}

export function demoKnowledge(snapshot: KnowledgeSnapshot, opts: { failure?: string; latency?: number } = {}): KnowledgeClient {
  const empty = opts.failure === "empty";
  const nodes = new Map(snapshot.graph.nodes.map((n) => [n.id, n]));
  const edges = snapshot.graph.edges;
  const docs = new Map(snapshot.documents.map((d) => [d.id, d]));
  const sections = new Map(snapshot.documents.flatMap((d) => d.outline.map((s) => [s.id, { ...s, documentId: d.id, documentTitle: d.title }] as const)));
  const chunks = Object.values(snapshot.chunks);
  const firstChunk = new Map<string, string>();
  for (const c of chunks.toSorted((x, y) => x.ordinal - y.ordinal)) if (!firstChunk.has(c.sectionId)) firstChunk.set(c.sectionId, c.chunkId);
  // Which documents contribute each node (for the document filter).
  const contributes = new Map<string, Set<string>>();
  for (const e of edges)
    for (const sp of snapshot.evidence[e.id] ?? [])
      for (const id of [e.source, e.target]) contributes.set(id, (contributes.get(id) ?? new Set()).add(sp.documentId));
  // BM25 statistics over the passages, computed once.
  const terms = chunks.map((c) => words(c.text).map(stem));
  const avgdl = terms.reduce((n, t) => n + t.length, 0) / Math.max(terms.length, 1);
  const df = new Map<string, number>();
  for (const t of terms) for (const w of new Set(t)) df.set(w, (df.get(w) ?? 0) + 1);
  const patterns = Object.entries(snapshot.aliases).flatMap(([id, list]) => list.map((a) => ({ id, re: aliasPattern(a) })));

  const wait = async (o?: RequestOptions) => {
    await delay(opts.latency ?? 120, o?.signal);
    if (opts.failure === "unavailable") throw new ApiError("UNAVAILABLE", "The demo knowledge library is set to fail (fail=knowledge:unavailable).", true);
  };
  const readOnly = async (o?: RequestOptions): Promise<never> => {
    await wait(o);
    throw new ApiError("PERMISSION_DENIED", READ_ONLY, false);
  };
  const notFound = (what: string) => new ApiError("NOT_FOUND", what, false);
  const visibleDocs = () => (empty ? [] : snapshot.documents);

  const evidenceItem = (sp: Span): EvidenceItem => {
    const c = sp.chunkId ? snapshot.chunks[sp.chunkId] : undefined;
    const d = docs.get(sp.documentId)!;
    return {
      documentId: sp.documentId,
      documentTitle: d.title,
      revision: d.revision,
      chunkId: sp.chunkId,
      sectionPath: c?.sectionPath ?? null,
      page: c?.page ?? null,
      rule: sp.rule ?? "mention",
      snippet: c ? snippet(c.text, sp.start, sp.end) : null,
    };
  };

  /** Vocabulary entities a question names: longest match first, no overlaps (as the service). */
  const seedsOf = (query: string) => {
    const found: { id: string; start: number; end: number }[] = [];
    for (const { id, re } of patterns) for (const m of query.matchAll(re)) found.push({ id, start: m.index, end: m.index + m[0].length });
    found.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
    const kept: typeof found = [];
    for (const f of found) {
      const last = kept.at(-1);
      if (last && f.start < last.end) {
        if (f.end - f.start > last.end - last.start) kept[kept.length - 1] = f;
        continue;
      }
      kept.push(f);
    }
    return [...new Set(kept.map((k) => k.id))].filter((id) => nodes.has(id));
  };

  return {
    mode: "demo",
    async status(o) {
      await wait(o);
      return { ...snapshot.status, storage: { engine: "demo snapshot", persistent: false, namespace: "knowledge" } };
    },
    async listDocuments(o) {
      await wait(o);
      const list = visibleDocs().map(({ outline: _o, firstChunk: _f, ...summary }) => summary);
      return { documents: list, totals: empty ? {} : snapshot.status.totals };
    },
    async getDocument(id, o) {
      await wait(o);
      const d = empty ? undefined : docs.get(id);
      if (!d) throw notFound("No document with this ID is in the library; it may have been removed.");
      return d;
    },
    ingestDocument: (_u, o) => readOnly(o),
    reindexDocument: (_d, o) => readOnly(o),
    deleteDocument: (_d, o) => readOnly(o),

    async searchKnowledge({ query, limit = 8 }, o) {
      await wait(o);
      const q = query.trim();
      const qTerms = [...new Set(words(q).filter((w) => !STOP.has(w)))].slice(0, 32);
      const seeds = empty ? [] : seedsOf(q);
      if (!qTerms.length && !seeds.length) throw new ApiError("INVALID_REQUEST", "Type a few words to search for.", false);
      const ranked: Record<"keyword" | "graph" | "vector", string[]> = { keyword: [], graph: [], vector: [] };
      const bm25 = new Map<string, number>();
      if (!empty) {
        const stems = qTerms.map(stem);
        chunks.forEach((c, i) => {
          const t = terms[i];
          let score = 0;
          for (const w of stems) {
            const tf = t.filter((x) => x === w).length;
            if (!tf) continue;
            const n = df.get(w) ?? 0;
            const idf = Math.log((chunks.length - n + 0.5) / (n + 0.5) + 1);
            score += (idf * tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * t.length) / avgdl));
          }
          if (score > 0) bm25.set(c.chunkId, score);
        });
        ranked.keyword = [...bm25.keys()].sort((a, b) => bm25.get(b)! - bm25.get(a)! || a.localeCompare(b)).slice(0, CANDIDATES);
      }
      // Graph: passages that describe the named entities, and the evidence of their relationships.
      type Path = { start: string; relation: string; end: string | null; relationId?: string; direction?: string };
      const score = new Map<string, number>();
      const paths = new Map<string, Path[]>();
      const add = (c: string, by: number, path: Path) => {
        score.set(c, (score.get(c) ?? 0) + by);
        paths.set(c, [...(paths.get(c) ?? []), path]);
      };
      const neighbours = new Set<string>();
      for (const seed of seeds) {
        const counts = new Map<string, number>();
        for (const sp of snapshot.mentions[seed] ?? []) if (sp.chunkId) counts.set(sp.chunkId, (counts.get(sp.chunkId) ?? 0) + 1);
        for (const [c, n] of counts) add(c, 2 + Math.min(n, 3) * 0.1, { start: seed, relation: "DESCRIBED_BY", end: snapshot.chunks[c].sectionId });
        for (const e of edges) {
          if (!SEMANTIC.has(e.type) || (e.source !== seed && e.target !== seed)) continue;
          const other = e.source === seed ? e.target : e.source;
          neighbours.add(other);
          for (const sp of snapshot.evidence[e.id] ?? [])
            if (sp.chunkId) add(sp.chunkId, 1, { start: seed, relation: e.type, end: other, relationId: e.id, direction: e.source === seed ? "out" : "in" });
        }
      }
      if (PROCEDURE.test(q)) for (const c of score.keys()) if (sections.get(snapshot.chunks[c].sectionId)?.procedure) score.set(c, score.get(c)! + 1.5);
      ranked.graph = [...score.keys()].sort((a, b) => score.get(b)! - score.get(a)! || a.localeCompare(b)).slice(0, CANDIDATES);
      // Reciprocal rank fusion.
      const fused = new Map<string, number>();
      for (const list of Object.values(ranked)) list.forEach((c, i) => fused.set(c, (fused.get(c) ?? 0) + 1 / (RRF_K + i + 1)));
      const top = [...fused.keys()].sort((a, b) => fused.get(b)! - fused.get(a)! || a.localeCompare(b)).slice(0, Math.min(Math.max(limit, 1), 20));
      const results = top.map((c, i): SearchResult["results"][number] => {
        const p = snapshot.chunks[c];
        const d = docs.get(p.documentId)!;
        const spans: [number, number][] = [];
        for (const t of qTerms) if (t.length > 2) for (const m of p.text.matchAll(new RegExp(`(?<!\\w)${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:e?s)?(?!\\w)`, "giu"))) spans.push([m.index, m.index + m[0].length]);
        for (const m of p.mentions) if (seeds.includes(m.entityId)) spans.push([m.start, m.end]);
        spans.sort((x, y) => x[0] - y[0]);
        const highlights: [number, number][] = [];
        for (const s of spans) {
          const last = highlights.at(-1);
          if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
          else highlights.push([s[0], s[1]]);
        }
        const unique = new Map((paths.get(c) ?? []).map((x) => [`${x.start}|${x.relation}|${x.end}`, x]));
        return {
          rank: i + 1,
          chunkId: c,
          documentId: p.documentId,
          documentTitle: p.documentTitle,
          documentName: p.documentName,
          revision: p.revision,
          sectionId: p.sectionId,
          sectionPath: p.sectionPath,
          page: p.page,
          procedure: Boolean(sections.get(p.sectionId)?.procedure),
          text: p.text,
          highlights: highlights.slice(0, 40),
          fusionScore: Math.round(fused.get(c)! * 1e5) / 1e5,
          methods: (["keyword", "graph"] as const)
            .filter((m) => ranked[m].includes(c))
            .map((m) =>
              m === "keyword"
                ? { method: m, rank: ranked.keyword.indexOf(c) + 1, bm25: Math.round(bm25.get(c)! * 1e4) / 1e4 }
                : { method: m, rank: ranked.graph.indexOf(c) + 1, paths: [...unique.values()].slice(0, 6) },
            ),
          entities: p.entities.slice(0, 12),
          provenance: { source: d.name, mediaType: d.mediaType, kind: d.kind, indexedAt: d.indexedAt, pipeline: d.pipeline, extraction: "rule-based vocabulary" },
        };
      });
      const documents = new Map<string, { id: string; title: string; passages: number }>();
      for (const r of results) {
        const entry = documents.get(r.documentId) ?? { id: r.documentId, title: r.documentTitle, passages: 0 };
        entry.passages += 1;
        documents.set(r.documentId, entry);
      }
      const names: SearchResult["names"] = {};
      for (const id of [...seeds, ...neighbours]) {
        const n = nodes.get(id);
        if (n) names[id] = { id, type: n.type, name: n.label };
      }
      for (const r of results) names[r.sectionId] = { id: r.sectionId, type: "section", name: sections.get(r.sectionId)?.heading ?? r.sectionPath };
      return {
        query: q,
        results,
        documents: [...documents.values()],
        methods: {
          keyword: { available: true, used: qTerms.length > 0, candidates: ranked.keyword.length },
          graph: { available: true, used: seeds.length > 0, candidates: ranked.graph.length, seeds: seeds.map((id) => ({ id, type: nodes.get(id)!.type, name: nodes.get(id)!.label })), unknownTerms: [] },
          vector: { available: false, used: false, reason: "No embedding service is configured." },
        },
        names,
        fusion: { method: "reciprocal rank fusion", k: RRF_K, note: "Scores order results; they are not probabilities." },
        answer: { available: false, reason: "No language model is configured for answer generation; these are the retrieved passages." },
      };
    },

    async getKnowledgeGraph(q = {}, o) {
      await wait(o);
      if (empty) return { nodes: [], edges: [], total: 0, truncated: false, limit: q.limit ?? 150 };
      const limit = Math.min(Math.max(q.limit ?? 150, 1), 300);
      const types = new Set<string>(q.types?.length ? q.types : snapshot.graph.nodes.map((n) => n.type));
      const pool = snapshot.graph.nodes
        .filter((n) => types.has(n.type) && (!q.document || n.documentId === q.document || contributes.get(n.id)?.has(q.document)))
        .sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
      const chosen = pool.slice(0, limit);
      const ids = new Set(chosen.map((n) => n.id));
      const edgeTypes = q.edgeTypes?.length ? new Set<string>(q.edgeTypes) : null;
      return {
        nodes: chosen,
        edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target) && (!edgeTypes || edgeTypes.has(e.type))),
        total: pool.length,
        truncated: pool.length > chosen.length,
        limit,
      };
    },

    async expandKnowledgeNode(id, q = {}, o) {
      await wait(o);
      const node = empty ? undefined : nodes.get(id);
      if (!node) throw notFound("This node is not in the knowledge graph; its document may have been removed or reindexed.");
      const limit = Math.min(Math.max(q.limit ?? 40, 1), 100);
      const edgeTypes = q.edgeTypes?.length ? new Set<string>(q.edgeTypes) : null;
      const own = edges
        .filter((e) => (e.source === id || e.target === id) && (!edgeTypes || edgeTypes.has(e.type)))
        .sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
      const shown = own.slice(0, limit);
      const others = [...new Set(shown.flatMap((e) => [e.source, e.target]))].filter((x) => x !== id).map((x) => nodes.get(x)!);
      const detail: NodeDetail = { node, neighbours: { nodes: others, edges: shown, hasMore: own.length > limit } };
      if (node.type === "section") {
        const s = sections.get(id)!;
        detail.section = { documentId: s.documentId, documentTitle: s.documentTitle, path: s.path, page: s.page, procedure: s.procedure, firstChunk: firstChunk.get(id) ?? null };
      } else if (node.type === "document") {
        const { outline: _o, firstChunk: _f, ...summary } = docs.get(id)!;
        detail.document = summary;
      } else {
        const spans = snapshot.mentions[id] ?? [];
        detail.mentions = { total: spans.length, items: spans.slice(0, 12).map(evidenceItem) };
      }
      return detail;
    },

    async inspectEvidence(edgeId, o): Promise<EdgeDetail> {
      await wait(o);
      const edge = empty ? undefined : edges.find((e) => e.id === edgeId);
      if (!edge) throw notFound("This relationship is no longer in the graph; the evidence behind it was removed or reindexed.");
      const spans = snapshot.evidence[edgeId] ?? [];
      return {
        edge: { ...edge, evidence: spans.length },
        source: nodes.get(edge.source) ?? null,
        target: nodes.get(edge.target) ?? null,
        evidence: { total: spans.length, items: spans.slice(0, 25).map(evidenceItem) },
      };
    },

    async getPassage(chunkId, o) {
      await wait(o);
      const p = empty ? undefined : snapshot.chunks[chunkId];
      if (!p) throw notFound("This passage is no longer in the library; its document was removed or reindexed.");
      return p;
    },
  };
}
