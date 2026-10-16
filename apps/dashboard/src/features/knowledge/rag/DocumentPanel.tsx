/**
 * One document: where it came from, how its ingestion went stage by stage (the indexing
 * diagnostics), its outline, and the management actions the local service allows
 * (reindex, remove). Removal says what goes with it before it happens.
 */
import { useState } from "react";
import { CircleCheck, CircleDashed, CircleMinus, Hourglass, ListTree, TriangleAlert } from "lucide-react";
import { useKnowledgeStrings } from "../../../lib/i18n/knowledge";
import { useResource } from "../../../lib/api/useResource";
import type { KnowledgeClient } from "../../../lib/api/knowledge";
import { Notice } from "../../../components/Notice";
import { Confirm, SidePanel, equipmentName, formatUtc } from "../shared";
import { DocumentStatusLabel } from "./Library";
import type { RagNav } from "./RagWorkspace";

const STAGE_ICONS = { pending: CircleDashed, running: Hourglass, done: CircleCheck, skipped: CircleMinus, failed: TriangleAlert };

export function DocumentPanel({
  client,
  id,
  nav,
  refresh,
  revision,
  onClose,
}: {
  client: KnowledgeClient;
  id: string;
  nav: RagNav;
  refresh: () => void;
  revision: number;
  onClose: () => void;
}) {
  const t = useKnowledgeStrings();
  const s = t.rag;
  const doc = useResource(`doc:${id}:${revision}`, `doc:${id}`, (signal) => client.getDocument(id, { signal }));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Record<string, number> | null>(null);
  const local = client.mode === "local";
  const d = doc.data;

  const reindex = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await client.reindexDocument(id);
      refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };
  const remove = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const result = await client.deleteDocument(id);
      setRemoved(result.removed);
      setConfirming(false);
      refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  if (removed) {
    return (
      <SidePanel title={s.doc.removedTitle} subject={`removed:${id}`} onClose={onClose} labelledBy="kn-doc-title">
        <p className="kn-done" role="status">
          {s.doc.removedSummary(removed.chunks ?? 0, removed.relations ?? 0, removed.entities ?? 0)}
        </p>
      </SidePanel>
    );
  }
  if (doc.error && !d) {
    return (
      <SidePanel title={s.doc.missingTitle} subject={`missing:${id}`} onClose={onClose} labelledBy="kn-doc-title">
        <Notice tone="warning">{doc.error.code === "NOT_FOUND" ? s.doc.missing : doc.error.message}</Notice>
      </SidePanel>
    );
  }
  if (!d) {
    return (
      <SidePanel title={s.doc.loadingTitle} subject={`loading:${id}`} onClose={onClose} labelledBy="kn-doc-title">
        <p className="kn-loading" role="status">
          {s.doc.loading}
        </p>
      </SidePanel>
    );
  }
  const working = d.status === "queued" || d.status === "processing";
  return (
    <SidePanel title={d.title} subject={id} onClose={onClose} labelledBy="kn-doc-title">
      <div className="kn-panel__row">
        <DocumentStatusLabel doc={d} />
        <span className="tag-chip">{s.kinds[d.kind as keyof typeof s.kinds] ?? d.kind}</span>
      </div>
      {d.error && <Notice tone="warning">{d.error}</Notice>}
      {d.status === "failed" && d.indexedAt && <p className="kn-note">{s.doc.previousIndex(formatUtc(d.indexedAt))}</p>}
      <dl className="kn-facts">
        <dt>{s.doc.source}</dt>
        <dd>
          {d.name} · {d.mediaType} · {(d.sizeBytes / 1024).toLocaleString("en-GB", { maximumFractionDigits: 1 })} KB
        </dd>
        <dt>{s.doc.identity}</dt>
        <dd>
          <code className="kn-code">{d.id}</code> · {s.doc.revision(d.revision)} · <span title={d.sha256}>sha256 {d.sha256.slice(0, 12)}…</span>
        </dd>
        {d.metadata.equipment.length > 0 && (
          <>
            <dt>{s.doc.equipment}</dt>
            <dd>{d.metadata.equipment.map(equipmentName).join(", ")}</dd>
          </>
        )}
        {(d.metadata.publisher || d.metadata.revisionLabel) && (
          <>
            <dt>{s.doc.publisher}</dt>
            <dd>{[d.metadata.publisher, d.metadata.revisionLabel].filter(Boolean).join(" · ")}</dd>
          </>
        )}
        <dt>{s.doc.added}</dt>
        <dd>{formatUtc(d.createdAt)}</dd>
        <dt>{s.doc.indexed}</dt>
        <dd>{d.indexedAt ? `${formatUtc(d.indexedAt)} · ${d.pipeline}` : s.library.notIndexed}</dd>
      </dl>

      <section className="kn-panel__section" aria-labelledby="kn-stages-title">
        <h4 id="kn-stages-title">{s.doc.stagesTitle}</h4>
        <ol className="kn-stages" aria-live={working ? "polite" : undefined}>
          {d.stages.map((st) => {
            const Icon = STAGE_ICONS[st.status];
            return (
              <li key={st.name} className={`kn-stage kn-stage--${st.status}`}>
                <Icon size={14} aria-hidden="true" />
                <span className="kn-stage__name">{s.stages[st.name]}</span>
                <span className="kn-stage__state">{s.stageStatus[st.status]}</span>
                {st.detail && <span className="kn-stage__detail">{st.detail}</span>}
              </li>
            );
          })}
        </ol>
      </section>

      {d.outline.length > 0 && (
        <section className="kn-panel__section" aria-labelledby="kn-outline-title">
          <h4 id="kn-outline-title">
            <ListTree size={15} aria-hidden="true" />
            {s.doc.outlineTitle(d.outline.length, d.chunkCount)}
          </h4>
          <ul className="kn-outline">
            {d.outline.map((o) => (
              <li key={o.id} style={{ paddingLeft: `${(o.level - 1) * 14}px` }}>
                {o.firstChunk ? (
                  <button type="button" className="kn-rowlink" onClick={() => nav.inspect({ kind: "passage", id: o.firstChunk! })}>
                    {o.heading}
                  </button>
                ) : (
                  <span>{o.heading}</span>
                )}
                {o.procedure && <span className="tag-chip kn-chip-sm">{t.types.procedure}</span>}
                {o.page !== null && <span className="kn-meta">{s.page(o.page)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="kn-panel__actions">
        {d.indexedAt && (
          <button type="button" className="button button--small" onClick={() => nav.inspect({ kind: "node", id })}>
            {s.doc.showInGraph}
          </button>
        )}
        {local && (
          <>
            <button type="button" className="button button--small" onClick={reindex} disabled={busy || working}>
              {s.doc.reindex}
            </button>
            <button type="button" className="button button--small kn-danger" onClick={() => setConfirming(true)} disabled={busy || confirming}>
              {s.doc.remove}
            </button>
          </>
        )}
      </div>
      {!local && <p className="kn-note">{s.library.demoNote}</p>}
      {confirming && (
        <Confirm
          message={s.doc.confirmRemove(d.title, d.chunkCount)}
          confirm={s.doc.removeConfirm}
          onConfirm={remove}
          onCancel={() => setConfirming(false)}
          busy={busy}
        />
      )}
      {actionError && (
        <p className="kn-error" role="alert">
          <TriangleAlert size={15} aria-hidden="true" />
          {actionError}
        </p>
      )}
    </SidePanel>
  );
}
