/**
 * One memory record: what happened, when it happened and when it was recorded, whether
 * it is still valid, its provenance, its versions, and what it links to. With the local
 * memory service: correct (a new version supersedes it; the old stays as history), link,
 * unlink and delete, which says what it will do first. An equipment item or a simulation
 * run lists the records about it.
 */
import { useState } from "react";
import { MoveRight, TriangleAlert, Unlink } from "lucide-react";
import { useKnowledgeStrings } from "../../../lib/i18n/knowledge";
import { useResource } from "../../../lib/api/useResource";
import type { MemoryClient } from "../../../lib/api/memory";
import type { LinkType, MemoryDeleted, MemoryDetail, MemoryKind, MemoryRecord, MemoryStatus } from "../../../lib/contracts/memory";
import { Notice } from "../../../components/Notice";
import { Confirm, SidePanel, equipmentName, formatUtc } from "../shared";
import { KIND_COLOURS, KIND_ICONS, KindLabel, ProvenanceTag } from "./kinds";
import { CorrectionForm, LinkForm } from "./MemoryForms";
import type { TimelineLink } from "./timeline";

/** A record as the chain and a link show it. */
export interface RecordRef {
  id: string;
  kind: MemoryKind;
  title: string;
  occurredAt: string;
}

export function MemoryPanel({
  client,
  id,
  revision,
  records,
  equipment,
  status,
  chain,
  onInspect,
  onChanged,
  onClose,
}: {
  client: MemoryClient;
  id: string;
  revision: number;
  records: MemoryRecord[];
  equipment: string[];
  status?: MemoryStatus;
  /** The records joined to this one through stored links, in time order (it included). */
  chain?: RecordRef[];
  onInspect: (id: string) => void;
  onChanged: (select?: string | null) => void;
  onClose: () => void;
}) {
  if (id.startsWith("equipment:") || id.startsWith("run:")) return <AnchorPanel key={id} client={client} id={id} revision={revision} onInspect={onInspect} onClose={onClose} />;
  // Keyed: a different record starts with fresh state (no carried-over delete summary or form).
  return <RecordPanel key={id} client={client} id={id} revision={revision} records={records} equipment={equipment} status={status} chain={chain} onInspect={onInspect} onChanged={onChanged} onClose={onClose} />;
}

function RecordPanel({
  client,
  id,
  revision,
  records,
  equipment,
  status,
  chain,
  onInspect,
  onChanged,
  onClose,
}: {
  client: MemoryClient;
  id: string;
  revision: number;
  records: MemoryRecord[];
  equipment: string[];
  status?: MemoryStatus;
  chain?: RecordRef[];
  onInspect: (id: string) => void;
  onChanged: (select?: string | null) => void;
  onClose: () => void;
}) {
  const s = useKnowledgeStrings().memory;
  const r = useResource(`mem:${id}:${revision}`, `mem:${id}`, (signal) => client.inspectMemory(id, { signal }));
  const [mode, setMode] = useState<"view" | "correct" | "link" | "delete">("view");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<MemoryDeleted | null>(null);
  const local = client.mode === "local";

  if (deleted) {
    return (
      <SidePanel title={s.panel.deletedTitle} subject={`deleted:${id}`} onClose={onClose} labelledBy="kn-mem-title">
        <p className="kn-done" role="status">
          {s.panel.deletedSummary(deleted.removedLinks, Boolean(deleted.restored))}
        </p>
        {deleted.restored && (
          <button type="button" className="button button--small" onClick={() => onInspect(deleted.restored!)}>
            {s.panel.openRestored}
          </button>
        )}
      </SidePanel>
    );
  }
  if (r.error && !r.data) {
    return (
      <SidePanel title={s.panel.missingTitle} subject={`missing:${id}`} onClose={onClose} labelledBy="kn-mem-title">
        <Notice tone="warning">{r.error.message}</Notice>
      </SidePanel>
    );
  }
  if (!r.data) {
    // The same subject as when it has loaded: arriving does not take the focus a second time
    // (someone may be typing in the search box by then).
    return (
      <SidePanel title={s.panel.loadingTitle} subject={id} onClose={onClose} labelledBy="kn-mem-title">
        <p className="kn-loading" role="status">
          {s.panel.loading}
        </p>
      </SidePanel>
    );
  }
  const { memory: m, links, history } = r.data;
  const run = async <T,>(action: () => Promise<T>, after: (v: T) => void) => {
    setBusy(true);
    setError(null);
    try {
      after(await action());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };
  const newer = m.supersededBy ? history.find((h) => h.id === m.supersededBy) : undefined;
  const older = m.supersedes ? history.find((h) => h.id === m.supersedes) : undefined;

  return (
    <SidePanel title={m.title} subject={id} onClose={onClose} labelledBy="kn-mem-title">
      <p className="kn-panel__row">
        <KindLabel kind={m.kind} />
        <ProvenanceTag provenance={m.provenance} runId={m.runId} />
        {m.status === "superseded" && <span className="tag-chip tag-chip--planned">{s.superseded}</span>}
      </p>
      <p className="kn-note">{s.provenance.explain[m.provenance]}</p>
      {m.body && <p className="kn-body">{m.body}</p>}
      <dl className="kn-facts">
        <dt>{s.panel.occurred}</dt>
        <dd>{formatUtc(m.occurredAt)}</dd>
        <dt>{s.panel.recorded}</dt>
        <dd>{formatUtc(m.recordedAt)}</dd>
        <dt>{s.panel.validity}</dt>
        <dd>
          {m.status === "current" ? (
            s.panel.current
          ) : (
            <>
              {s.panel.supersededAt(formatUtc(m.validUntil))}{" "}
              {newer && (
                <button type="button" className="text-button" onClick={() => onInspect(newer.id)}>
                  {s.panel.openCurrent}
                </button>
              )}
            </>
          )}
        </dd>
        {m.equipment.length > 0 && (
          <>
            <dt>{s.panel.equipment}</dt>
            <dd className="kn-inline-list">
              {m.equipment.map((eq) => (
                <button key={eq} type="button" className="text-button" onClick={() => onInspect(`equipment:${eq}`)}>
                  {equipmentName(eq)}
                </button>
              ))}
            </dd>
          </>
        )}
        {m.runId && (
          <>
            <dt>{s.panel.run}</dt>
            <dd>
              <button type="button" className="text-button" onClick={() => onInspect(`run:${m.runId}`)}>
                {m.runId}
              </button>{" "}
              <span className="kn-meta">{s.panel.runNote}</span>
            </dd>
          </>
        )}
        {m.sourceRef && (
          <>
            <dt>{s.panel.sourceRef}</dt>
            <dd>{m.sourceRef}</dd>
          </>
        )}
        {older && (
          <>
            <dt>{s.panel.corrects}</dt>
            <dd>
              <button type="button" className="text-button" onClick={() => onInspect(older.id)}>
                {older.title}
              </button>
              {m.correctionReason && <span className="kn-meta"> {s.panel.because(m.correctionReason)}</span>}
            </dd>
          </>
        )}
        <dt>{s.panel.id}</dt>
        <dd>
          <code className="kn-code">{m.id}</code>
        </dd>
      </dl>

      {history.length > 1 && (
        <section className="kn-panel__section" aria-labelledby="kn-history-title">
          <h4 id="kn-history-title">{s.panel.history(history.length)}</h4>
          <ol className="kn-history">
            {history.map((h) => (
              <li key={h.id} aria-current={h.id === m.id || undefined}>
                <button type="button" className="kn-rowlink" onClick={() => onInspect(h.id)} disabled={h.id === m.id}>
                  {h.title}
                </button>
                <span className="kn-meta">
                  {s.panel.versionMeta(formatUtc(h.recordedAt), h.status === "current")}
                  {h.correctionReason && ` · ${h.correctionReason}`}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="kn-panel__section" aria-labelledby="kn-links-title">
        <h4 id="kn-links-title">{s.panel.links(links.length)}</h4>
        {links.length === 0 && <p className="kn-meta">{s.panel.noLinks}</p>}
        <ul className="kn-rels">
          {links.map((l) => (
            <li key={l.id}>
              <span className="kn-rel kn-rel--static">{s.linkPhrases[l.direction][l.type as LinkType]}</span>
              {l.other ? (
                <button type="button" className="kn-rowlink" onClick={() => onInspect(l.other!.id)}>
                  {l.other.title}
                  <span className="kn-meta">
                    {s.kinds[l.other.kind]} · {formatUtc(l.other.occurredAt)}
                    {l.other.status === "superseded" && ` · ${s.superseded}`}
                  </span>
                </button>
              ) : (
                <span className="kn-meta">{s.panel.linkGone}</span>
              )}
              {local && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={s.panel.unlink}
                  title={s.panel.unlink}
                  disabled={busy}
                  onClick={() => run(() => client.unlinkMemories(id, l.id), () => onChanged())}
                >
                  <Unlink size={14} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {chain && chain.length > 2 && (
        <section className="kn-panel__section" aria-labelledby="kn-chain-title">
          <h4 id="kn-chain-title">{s.chain(chain.length)}</h4>
          <p className="kn-meta">{s.chainNote}</p>
          <ol className="kn-history mm-chain">
            {chain.map((c) => {
              const Icon = KIND_ICONS[c.kind];
              return (
                <li key={c.id} aria-current={c.id === m.id || undefined}>
                  <Icon size={14} aria-hidden="true" style={{ color: KIND_COLOURS[c.kind] }} />
                  <button type="button" className="kn-rowlink" onClick={() => onInspect(c.id)} disabled={c.id === m.id}>
                    {c.title}
                  </button>
                  <span className="kn-meta">
                    {s.kinds[c.kind]} · {formatUtc(c.occurredAt)}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {local && m.status === "current" && mode === "view" && (
        <div className="kn-panel__actions">
          <button type="button" className="button button--small" onClick={() => setMode("correct")}>
            {s.panel.correct}
          </button>
          <button type="button" className="button button--small" onClick={() => setMode("link")}>
            {s.panel.link}
          </button>
          <button type="button" className="button button--small kn-danger" onClick={() => setMode("delete")}>
            {s.panel.delete}
          </button>
        </div>
      )}
      {local && m.status === "superseded" && mode === "view" && (
        <div className="kn-panel__actions">
          <button type="button" className="button button--small kn-danger" onClick={() => setMode("delete")}>
            {s.panel.delete}
          </button>
        </div>
      )}
      {!local && <p className="kn-note">{s.demoNote}</p>}
      {mode === "correct" && status && (
        <CorrectionForm
          client={client}
          record={m}
          equipment={equipment}
          onDone={(next: MemoryDetail | null) => {
            setMode("view");
            if (next) onChanged(next.memory.id);
          }}
        />
      )}
      {mode === "link" && (
        <LinkForm
          client={client}
          record={m}
          records={records.filter((x) => x.id !== m.id)}
          onDone={(changed) => {
            setMode("view");
            if (changed) onChanged();
          }}
        />
      )}
      {mode === "delete" && (
        <Confirm
          message={s.panel.confirmDelete(m.title, links.length, older?.title ?? null, newer?.title ?? null)}
          confirm={s.panel.deleteConfirm}
          busy={busy}
          onCancel={() => setMode("view")}
          onConfirm={() =>
            run(
              () => client.deleteMemory(id),
              (effects) => {
                setDeleted(effects);
                onChanged();
              },
            )
          }
        />
      )}
      {error && (
        <p className="kn-error" role="alert">
          <TriangleAlert size={15} aria-hidden="true" />
          {error}
        </p>
      )}
    </SidePanel>
  );
}

/** A stored link chosen on the timeline: what it joins, which way, and when it was made (the
 *  source record's own account of it). */
export function LinkPanel({
  client,
  id,
  link,
  records,
  revision,
  onInspect,
  onClose,
}: {
  client: MemoryClient;
  id: string;
  link?: TimelineLink;
  records: Map<string, RecordRef>;
  revision: number;
  onInspect: (id: string) => void;
  onClose: () => void;
}) {
  const s = useKnowledgeStrings().memory;
  const r = useResource(link ? `mlink:${link.source}:${revision}` : null, `mlink:${id}`, (signal) => client.inspectMemory(link!.source, { signal }));
  const stored = r.data?.links.find((l) => l.id === id);
  const from = link ? records.get(link.source) : undefined;
  const to = link ? records.get(link.target) : undefined;
  const type = link && link.type !== "SUPERSEDES" ? (link.type as LinkType) : null;
  const end = (rec: RecordRef | undefined, fallback: string) =>
    rec ? (
      <button type="button" className="kn-rowlink" onClick={() => onInspect(rec.id)}>
        {rec.title}
        <span className="kn-meta">
          {s.kinds[rec.kind]} · {formatUtc(rec.occurredAt)}
        </span>
      </button>
    ) : (
      <span className="kn-meta">{fallback}</span>
    );
  return (
    <SidePanel title={type ? s.linkPhrases.out[type] : s.edgeTypes.SUPERSEDES} subject={`link:${id}`} onClose={onClose} labelledBy="kn-link-title">
      {!link || !type ? (
        <p className="kn-meta">{s.link.gone}</p>
      ) : (
        <>
          <dl className="kn-facts">
            <dt>{s.link.from}</dt>
            <dd>{end(from, link.source)}</dd>
            <dt aria-hidden="true" />
            <dd className="kn-meta mm-link-phrase">
              <MoveRight size={14} aria-hidden="true" /> {s.edgeTypes[type]}
            </dd>
            <dt>{s.link.to}</dt>
            <dd>{end(to, link.target)}</dd>
          </dl>
          {stored && <p className="kn-meta">{s.link.stored(formatUtc(stored.createdAt))}</p>}
          {!r.data && !r.error && (
            <p className="kn-loading" role="status">
              {s.link.loading}
            </p>
          )}
          {r.error && <Notice tone="warning">{r.error.message}</Notice>}
          <p className="kn-note">{s.link.note}</p>
        </>
      )}
    </SidePanel>
  );
}

/** An equipment item or a simulation run: the records about it, newest first. */
function AnchorPanel({ client, id, revision, onInspect, onClose }: { client: MemoryClient; id: string; revision: number; onInspect: (id: string) => void; onClose: () => void }) {
  const s = useKnowledgeStrings().memory;
  const r = useResource(`anchor:${id}:${revision}`, `anchor:${id}`, (signal) => client.expandMemoryNode(id, { limit: 40 }, { signal }));
  const isRun = id.startsWith("run:");
  const name = isRun ? id.slice(4) : equipmentName(id.slice(10));
  const records = (r.data?.nodes ?? []).filter((n) => n.occurredAt).sort((a, b) => b.occurredAt!.localeCompare(a.occurredAt!));
  return (
    <SidePanel title={name} subject={id} onClose={onClose} labelledBy="kn-anchor-title">
      <p className="kn-note">{isRun ? s.panel.runAnchor : s.panel.equipmentAnchor}</p>
      {r.error && <Notice tone="warning">{r.error.message}</Notice>}
      {!r.data && !r.error && (
        <p className="kn-loading" role="status">
          {s.panel.loading}
        </p>
      )}
      <ol className="kn-history">
        {records.map((n) => (
          <li key={n.id}>
            <button type="button" className="kn-rowlink" onClick={() => onInspect(n.id)}>
              {n.label}
            </button>
            <span className="kn-meta">
              {s.nodeTypes[n.type]} · {formatUtc(n.occurredAt)}
              {n.status === "superseded" && ` · ${s.superseded}`}
            </span>
          </li>
        ))}
      </ol>
      {r.data?.hasMore && <p className="kn-meta">{s.panel.anchorMore(r.data.total)}</p>}
    </SidePanel>
  );
}
