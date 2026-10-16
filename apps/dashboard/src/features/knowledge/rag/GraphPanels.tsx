/**
 * Graph inspection: a node with its relationships and where it is mentioned, and a
 * relationship with the source evidence that justifies it and the rule that read it.
 * Every item leads to the exact passage.
 */
import { ArrowRight, Network } from "lucide-react";
import { useKnowledgeStrings } from "../../../lib/i18n/knowledge";
import { useResource } from "../../../lib/api/useResource";
import type { KnowledgeClient } from "../../../lib/api/knowledge";
import type { EdgeType, EvidenceItem, NodeType } from "../../../lib/contracts/knowledge";
import { Notice } from "../../../components/Notice";
import { ShapeGlyph } from "../graph/GraphCanvas";
import { SidePanel, Snippet, formatUtc } from "../shared";
import { KNOWLEDGE_SHAPES } from "./KnowledgeGraphView";
import type { RagNav } from "./RagWorkspace";

function Evidence({ items, total, nav }: { items: EvidenceItem[]; total: number; nav: RagNav }) {
  const t = useKnowledgeStrings();
  const s = t.evidence;
  return (
    <>
      <ul className="kn-evidence">
        {items.map((e, i) => (
          <li key={`${e.chunkId}:${i}`}>
            <Snippet snippet={e.snippet} />
            <span className="kn-meta">
              {e.documentTitle}
              {e.sectionPath && ` › ${e.sectionPath.split(" › ").slice(1).join(" › ") || e.sectionPath}`}
              {e.page !== null && ` · ${t.rag.page(e.page)}`} · {t.rules[e.rule as keyof typeof t.rules] ?? e.rule}
            </span>
            {e.chunkId && (
              <button type="button" className="text-button" onClick={() => nav.inspect({ kind: "passage", id: e.chunkId! })}>
                {s.read}
              </button>
            )}
          </li>
        ))}
      </ul>
      {total > items.length && <p className="kn-meta">{s.more(items.length, total)}</p>}
    </>
  );
}

export function NodePanel({ client, id, nav, onClose }: { client: KnowledgeClient; id: string; nav: RagNav; onClose: () => void }) {
  const t = useKnowledgeStrings();
  const s = t.graph.node;
  const r = useResource(`node:${id}`, "node", (signal) => client.expandKnowledgeNode(id, { limit: 60 }, { signal }));
  if (r.error && !r.data) {
    return (
      <SidePanel title={s.missingTitle} subject={`missing:${id}`} onClose={onClose} labelledBy="kn-node-title">
        <Notice tone="warning">{r.error.message}</Notice>
      </SidePanel>
    );
  }
  if (!r.data) {
    return (
      <SidePanel title={s.loadingTitle} subject={`loading:${id}`} onClose={onClose} labelledBy="kn-node-title">
        <p className="kn-loading" role="status">
          {s.loading}
        </p>
      </SidePanel>
    );
  }
  const { node, neighbours, section, document, mentions } = r.data;
  const others = new Map(neighbours.nodes.map((n) => [n.id, n]));
  return (
    <SidePanel title={node.label} subject={id} onClose={onClose} labelledBy="kn-node-title">
      <p className="kn-panel__row">
        <span className="tag-chip kn-typetag">
          <ShapeGlyph shape={KNOWLEDGE_SHAPES[node.type]} />
          {t.types[node.type]}
        </span>
        <span className="kn-meta">{s.degree(node.degree)}</span>
      </p>
      {section && (
        <p className="kn-panel__row">
          <button type="button" className="kn-rowlink" onClick={() => nav.inspect({ kind: "doc", id: section.documentId })}>
            {section.documentTitle}
          </button>
          {section.page !== null && <span className="kn-meta">{t.rag.page(section.page)}</span>}
          {section.firstChunk && (
            <button type="button" className="button button--small" onClick={() => nav.inspect({ kind: "passage", id: section.firstChunk! })}>
              {s.readSection}
            </button>
          )}
        </p>
      )}
      {document && (
        <p className="kn-panel__row">
          <button type="button" className="button button--small" onClick={() => nav.inspect({ kind: "doc", id: document.id })}>
            {s.openDocument}
          </button>
          <span className="kn-meta">{document.name}</span>
        </p>
      )}
      <section className="kn-panel__section" aria-labelledby="kn-rel-title">
        <h4 id="kn-rel-title">{s.relationships(neighbours.edges.length)}</h4>
        <ul className="kn-rels">
          {neighbours.edges.map((e) => {
            const out = e.source === id;
            const other = others.get(out ? e.target : e.source);
            return (
              <li key={e.id}>
                <button type="button" className="kn-rel" onClick={() => nav.inspect({ kind: "edge", id: e.id })}>
                  {out ? t.relations[e.type as EdgeType] : t.inverse[e.type as EdgeType]}
                  <span className="kn-meta">{s.evidenceCount(e.evidence)}</span>
                </button>
                {other && (
                  <button type="button" className="kn-rowlink" onClick={() => nav.inspect({ kind: "node", id: other.id })}>
                    <ShapeGlyph shape={KNOWLEDGE_SHAPES[other.type as NodeType]} />
                    {other.label}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {neighbours.hasMore && <p className="kn-meta">{s.moreRelationships}</p>}
        <button type="button" className="button button--small" onClick={() => nav.expand(id)}>
          <Network size={14} aria-hidden="true" />
          {s.expand}
        </button>
      </section>
      {mentions && (
        <section className="kn-panel__section" aria-labelledby="kn-mentions-title">
          <h4 id="kn-mentions-title">{s.mentions(mentions.total)}</h4>
          <Evidence items={mentions.items} total={mentions.total} nav={nav} />
        </section>
      )}
      <section className="kn-panel__section" aria-labelledby="kn-prov-title">
        <h4 id="kn-prov-title">{s.provenance}</h4>
        <p className="kn-note">
          {document
            ? s.fromDocument(document.name, document.revision, formatUtc(document.indexedAt ?? document.updatedAt))
            : section
              ? s.fromSection(section.documentTitle)
              : s.fromVocabulary}
        </p>
      </section>
    </SidePanel>
  );
}

export function EdgePanel({ client, id, nav, onClose }: { client: KnowledgeClient; id: string; nav: RagNav; onClose: () => void }) {
  const t = useKnowledgeStrings();
  const s = t.graph.edge;
  const r = useResource(`edge:${id}`, "edge", (signal) => client.inspectEvidence(id, { signal }));
  if (r.error && !r.data) {
    return (
      <SidePanel title={s.missingTitle} subject={`missing:${id}`} onClose={onClose} labelledBy="kn-edge-title">
        <Notice tone="warning">{r.error.message}</Notice>
      </SidePanel>
    );
  }
  if (!r.data) {
    return (
      <SidePanel title={s.loadingTitle} subject={`loading:${id}`} onClose={onClose} labelledBy="kn-edge-title">
        <p className="kn-loading" role="status">
          {s.loading}
        </p>
      </SidePanel>
    );
  }
  const { edge, source, target, evidence } = r.data;
  const rules = [...new Set(evidence.items.map((e) => e.rule))];
  return (
    <SidePanel title={t.relationNames[edge.type]} subject={id} onClose={onClose} labelledBy="kn-edge-title">
      <p className="kn-edgeends">
        {source && (
          <button type="button" className="kn-rowlink" onClick={() => nav.inspect({ kind: "node", id: source.id })}>
            <ShapeGlyph shape={KNOWLEDGE_SHAPES[source.type]} />
            {source.label}
          </button>
        )}
        <span className="kn-path__rel">
          {t.relations[edge.type]} <ArrowRight size={13} aria-hidden="true" />
        </span>
        {target && (
          <button type="button" className="kn-rowlink" onClick={() => nav.inspect({ kind: "node", id: target.id })}>
            <ShapeGlyph shape={KNOWLEDGE_SHAPES[target.type]} />
            {target.label}
          </button>
        )}
      </p>
      <section className="kn-panel__section" aria-labelledby="kn-why-title">
        <h4 id="kn-why-title">{s.why}</h4>
        <ul className="kn-rules">
          {rules.map((rule) => (
            <li key={rule}>{t.ruleExplanations[rule as keyof typeof t.ruleExplanations] ?? rule}</li>
          ))}
        </ul>
      </section>
      <section className="kn-panel__section" aria-labelledby="kn-evidence-title">
        <h4 id="kn-evidence-title">{s.evidence(evidence.total)}</h4>
        <Evidence items={evidence.items} total={evidence.total} nav={nav} />
      </section>
    </SidePanel>
  );
}
