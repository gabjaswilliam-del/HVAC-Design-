/**
 * The source reader: one indexed passage exactly as stored, with the vocabulary terms it
 * mentions marked, its place in the document, and the passages around it. A citation
 * that no longer resolves (the document was removed or reindexed) says so instead.
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useKnowledgeStrings } from "../../../lib/i18n/knowledge";
import { useResource } from "../../../lib/api/useResource";
import type { KnowledgeClient } from "../../../lib/api/knowledge";
import { Notice } from "../../../components/Notice";
import { Highlighted, SidePanel, formatUtc } from "../shared";
import type { RagNav } from "./RagWorkspace";

export function PassagePanel({ client, id, nav, onClose }: { client: KnowledgeClient; id: string; nav: RagNav; onClose: () => void }) {
  const t = useKnowledgeStrings();
  const s = t.rag.passage;
  const p = useResource(`passage:${id}`, "passage", (signal) => client.getPassage(id, { signal }));
  if (p.error && !p.data) {
    return (
      <SidePanel title={s.missingTitle} subject={`missing:${id}`} onClose={onClose} labelledBy="kn-passage-title">
        <Notice tone="warning">{p.error.code === "NOT_FOUND" ? s.missing : p.error.message}</Notice>
      </SidePanel>
    );
  }
  if (!p.data) {
    return (
      <SidePanel title={s.loadingTitle} subject={`loading:${id}`} onClose={onClose} labelledBy="kn-passage-title">
        <p className="kn-loading" role="status">
          {s.loading}
        </p>
      </SidePanel>
    );
  }
  const d = p.data;
  return (
    <SidePanel title={d.sectionPath.split(" › ").at(-1)} subject={id} onClose={onClose} labelledBy="kn-passage-title">
      <p className="kn-panel__row">
        <button type="button" className="kn-rowlink" onClick={() => nav.inspect({ kind: "doc", id: d.documentId })}>
          {d.documentTitle}
        </button>
        <span className="kn-meta">
          {t.rag.doc.revision(d.revision)}
          {d.page !== null && ` · ${t.rag.page(d.page)}`} · {s.number(d.ordinal + 1)}
        </span>
      </p>
      <p className="kn-meta">{d.sectionPath}</p>
      <blockquote className="kn-passage" aria-label={s.textLabel}>
        <Highlighted text={d.text} ranges={d.mentions.map((m) => [m.start, m.end] as const)} />
      </blockquote>
      {d.entities.length > 0 && (
        <div className="kn-panel__section">
          <h4>{s.mentions}</h4>
          <ul className="kn-chips">
            {d.entities.map((e) => (
              <li key={e.id}>
                <button type="button" className="chip kn-chip-button" onClick={() => nav.inspect({ kind: "node", id: e.id }, "graph")}>
                  <span className="kn-chip-type">{t.types[e.type as keyof typeof t.types] ?? e.type}</span>
                  {e.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="kn-panel__actions">
        <button type="button" className="button button--small" disabled={!d.previous} onClick={() => d.previous && nav.inspect({ kind: "passage", id: d.previous })}>
          <ChevronLeft size={15} aria-hidden="true" />
          {s.previous}
        </button>
        <button type="button" className="button button--small" disabled={!d.next} onClick={() => d.next && nav.inspect({ kind: "passage", id: d.next })}>
          {s.next}
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      </div>
      <p className="kn-note">{s.provenance(d.documentName, formatUtc(d.indexedAt))}</p>
    </SidePanel>
  );
}
