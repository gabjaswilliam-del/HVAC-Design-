/**
 * The document library: what the service can do (formats, limits, extraction, vectors,
 * answers), the documents with their ingestion status, and adding a document. Adding is
 * a job: a document is queued, processed in stages and indexed; import is not indexing,
 * so the status says which it is. In the demo the library is fixed and says so.
 */
import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { CircleCheck, Clock, FilePlus2, Hourglass, TriangleAlert } from "lucide-react";
import { useKnowledgeStrings } from "../../../lib/i18n/knowledge";
import { motion } from "../../../lib/motion";
import { Notice } from "../../../components/Notice";
import { ApiError } from "../../../lib/api/client";
import type { Resource } from "../../../lib/api/useResource";
import type { KnowledgeClient } from "../../../lib/api/knowledge";
import { DOCUMENT_KINDS, type DocumentList, type DocumentStatus, type DocumentSummary, type KnowledgeStatus } from "../../../lib/contracts/knowledge";
import { formatUtc } from "../shared";
import type { RagNav } from "./RagWorkspace";

const ICONS = { queued: Clock, processing: Hourglass, ready: CircleCheck, partial: TriangleAlert, failed: TriangleAlert };

export function DocumentStatusLabel({ doc }: { doc: Pick<DocumentSummary, "status" | "stages"> }) {
  const s = useKnowledgeStrings().rag;
  const Icon = ICONS[doc.status];
  const running = doc.stages.find((x) => x.status === "running");
  return (
    <span className={`state-label kn-status kn-status--${doc.status}`}>
      <Icon size={14} aria-hidden="true" />
      {doc.status === "processing" && running ? s.status.processingStage(s.stages[running.name]) : s.status[doc.status]}
    </span>
  );
}

export function Library({
  client,
  docs,
  status,
  nav,
  refresh,
  selected,
}: {
  client: KnowledgeClient;
  docs: Resource<DocumentList>;
  status: Resource<KnowledgeStatus>;
  nav: RagNav;
  refresh: () => void;
  selected: string | null;
}) {
  const s = useKnowledgeStrings().rag;
  const [adding, setAdding] = useState(false);
  const local = client.mode === "local";
  const list = docs.data?.documents;
  const totals = docs.data?.totals ?? {};

  // A document whose status changed since the last read draws the eye once (GSAP).
  const seen = useRef(new Map<string, DocumentStatus>());
  const table = useRef<HTMLTableElement>(null);
  useLayoutEffect(() => {
    for (const d of list ?? []) {
      const before = seen.current.get(d.id);
      if (before && before !== d.status) motion.changed(table.current?.querySelector(`[data-doc="${d.id}"] .kn-status`));
      seen.current.set(d.id, d.status);
    }
  }, [list]);

  return (
    <section className="kn-section" aria-labelledby="kn-library-title">
      <div className="kn-section__head">
        <h2 id="kn-library-title">{s.library.title}</h2>
        {list && <span className="kn-count">{s.library.count(list.length, totals.chunks ?? 0, totals.relations ?? 0)}</span>}
        {local && !adding && (
          <button type="button" className="button button--primary kn-section__action" onClick={() => setAdding(true)}>
            <FilePlus2 size={16} aria-hidden="true" />
            {s.library.add}
          </button>
        )}
      </div>
      {!local && <p className="kn-note">{s.library.demoNote}</p>}
      {status.data && <Capabilities status={status.data} />}
      {status.error && !status.data && <Notice tone="warning">{s.library.statusFailed(status.error.message)}</Notice>}
      {adding && status.data && (
        <UploadForm
          client={client}
          status={status.data}
          onDone={(id) => {
            setAdding(false);
            refresh();
            if (id) nav.inspect({ kind: "doc", id });
          }}
          onOpen={(id) => nav.inspect({ kind: "doc", id })}
        />
      )}
      {docs.error && (
        <Notice tone="critical" action={{ label: s.retry, onClick: docs.retry }}>
          {s.library.loadFailed(docs.error.message)}
        </Notice>
      )}
      {!list && !docs.error && (
        <p className="kn-loading" role="status">
          {s.library.loading}
        </p>
      )}
      {list && !list.length && <p className="kn-empty">{local ? s.library.emptyLocal : s.library.emptyDemo}</p>}
      {list && list.length > 0 && (
        <table ref={table} className="data-table kn-docs">
          <caption className="visually-hidden">{s.library.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{s.library.columns.document}</th>
              <th scope="col">{s.library.columns.status}</th>
              <th scope="col" className="num">
                {s.library.columns.passages}
              </th>
              <th scope="col">{s.library.columns.indexed}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((d) => (
              <tr key={d.id} data-doc={d.id} aria-current={selected === d.id || undefined}>
                <th scope="row">
                  <button type="button" className="kn-rowlink" onClick={() => nav.inspect({ kind: "doc", id: d.id })}>
                    {d.title}
                  </button>
                  <span className="kn-meta">
                    {d.name} · {s.kinds[d.kind as keyof typeof s.kinds] ?? d.kind}
                  </span>
                </th>
                <td>
                  <DocumentStatusLabel doc={d} />
                  {d.error && <span className="kn-meta kn-meta--caution">{d.error}</span>}
                </td>
                <td className="num">{d.chunkCount}</td>
                <td className="kn-meta">{d.indexedAt ? formatUtc(d.indexedAt) : s.library.notIndexed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** What this service does and does not do, as facts with their state. */
function Capabilities({ status }: { status: KnowledgeStatus }) {
  const s = useKnowledgeStrings().rag.capabilities;
  const formats = status.formats.filter((f) => f.available).map((f) => f.extensions.join(" ")).join(", ");
  const pdf = status.formats.find((f) => f.mediaType === "application/pdf");
  return (
    <dl className="context-bar kn-caps">
      <div>
        <dt>{s.storage}</dt>
        <dd>{status.storage.persistent ? s.persistent(status.storage.engine) : s.demoStore}</dd>
      </div>
      <div>
        <dt>{s.formats}</dt>
        <dd>
          {formats} · {s.limit(Math.round(status.maxBytes / 1048576))}
          {pdf && !pdf.available && (
            <span className="kn-meta kn-meta--caution" title={pdf.reason}>
              {s.pdfOff}
            </span>
          )}
        </dd>
      </div>
      <div>
        <dt>{s.extraction}</dt>
        <dd title={status.extraction.model.reason}>{s.ruleBased(status.extraction.vocabulary)}</dd>
      </div>
      <div>
        <dt>{s.vectors}</dt>
        <dd title={status.embeddings.reason}>{status.embeddings.available ? s.vectorsOn(status.embeddings.model ?? "") : s.notConfigured}</dd>
      </div>
      <div>
        <dt>{s.answers}</dt>
        <dd title={status.answers.reason}>{s.noAnswers}</dd>
      </div>
    </dl>
  );
}

const toBase64 = async (file: File) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
};

function UploadForm({ client, status, onDone, onOpen }: { client: KnowledgeClient; status: KnowledgeStatus; onDone: (id: string | null) => void; onOpen: (id: string) => void }) {
  const s = useKnowledgeStrings().rag.upload;
  const kinds = useKnowledgeStrings().rag.kinds;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; existing?: string } | null>(null);
  const extensions = status.formats.filter((f) => f.available).flatMap((f) => f.extensions);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || !file.name) return setError({ message: s.chooseFile });
    const ext = file.name.includes(".") ? `.${file.name.split(".").pop()!.toLowerCase()}` : "";
    if (!extensions.includes(ext)) return setError({ message: s.unsupported(ext || s.noExtension, extensions.join(", ")) });
    if (!file.size) return setError({ message: s.empty });
    if (file.size > status.maxBytes) return setError({ message: s.tooLarge((file.size / 1048576).toFixed(1), Math.round(status.maxBytes / 1048576)) });
    const equipment = String(form.get("equipment") ?? "")
      .split(/[\s,]+/)
      .filter(Boolean);
    if (equipment.some((x) => !/^[a-z][a-z0-9_]{0,63}$/.test(x))) return setError({ message: s.badEquipment });
    setBusy(true);
    setError(null);
    try {
      const doc = await client.ingestDocument({
        name: file.name,
        contentBase64: await toBase64(file),
        kind: String(form.get("kind")),
        title: String(form.get("title") ?? "").trim() || undefined,
        equipment: equipment.length ? equipment : undefined,
        publisher: String(form.get("publisher") ?? "").trim() || undefined,
        revisionLabel: String(form.get("revisionLabel") ?? "").trim() || undefined,
      });
      onDone(doc.id);
    } catch (err) {
      const existing = err instanceof ApiError && typeof err.details?.existingDocumentId === "string" ? err.details.existingDocumentId : undefined;
      setError({ message: err instanceof Error ? err.message : String(err), existing });
      setBusy(false);
    }
  };
  return (
    <form noValidate className="kn-form" onSubmit={submit} aria-labelledby="kn-upload-title" aria-busy={busy || undefined}>
      <h3 id="kn-upload-title">{s.title}</h3>
      <p className="kn-hint">{s.hint(extensions.join(", "), Math.round(status.maxBytes / 1048576))}</p>
      <div className="kn-form__grid">
        <label className="kn-field kn-field--wide">
          <span>{s.file}</span>
          <input name="file" type="file" accept={extensions.join(",")} required disabled={busy} />
        </label>
        <label className="kn-field kn-field--wide">
          <span>{s.docTitle}</span>
          <input name="title" type="text" maxLength={200} placeholder={s.docTitlePlaceholder} disabled={busy} />
        </label>
        <label className="kn-field">
          <span>{s.kind}</span>
          <select name="kind" className="select" defaultValue="reference" disabled={busy}>
            {DOCUMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {kinds[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="kn-field">
          <span>{s.equipment}</span>
          <input name="equipment" type="text" placeholder="chiller_plant_2" disabled={busy} />
        </label>
        <label className="kn-field">
          <span>{s.publisher}</span>
          <input name="publisher" type="text" maxLength={120} disabled={busy} />
        </label>
        <label className="kn-field">
          <span>{s.revisionLabel}</span>
          <input name="revisionLabel" type="text" maxLength={60} disabled={busy} />
        </label>
      </div>
      {error && (
        <p className="kn-error" role="alert">
          <TriangleAlert size={15} aria-hidden="true" />
          {error.message}
          {error.existing && (
            <button type="button" className="text-button" onClick={() => onOpen(error.existing!)}>
              {s.openExisting}
            </button>
          )}
        </p>
      )}
      <div className="kn-form__actions">
        <button type="submit" className="button button--primary" disabled={busy}>
          {busy ? s.adding : s.submit}
        </button>
        <button type="button" className="button" onClick={() => onDone(null)} disabled={busy}>
          {s.cancel}
        </button>
      </div>
    </form>
  );
}
