/**
 * The Project Library: the prepared sample (pinned), then the saved projects by when they were
 * last opened (or, in demo mode, the drawings added in this tab). The landing page when no
 * project is open; a column beside an open one.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CircleAlert, CircleCheck, CircleMinus, FileUp, MoreHorizontal, RotateCw, Search } from "lucide-react";
import type { ProjectSummary } from "../../lib/contracts/cadProject";
import { useStrings } from "../../lib/i18n";
import { useDismissOutside, useEscapeLayer } from "../../components/escape";
import { cad, isDirty, openFindings, SAMPLE_FILENAME, SAMPLE_KEY, useCadSession, type OpenTarget } from "./cadSession";
import { formatBytes } from "./review";
import { Thumbnail } from "./Thumbnail";

interface Row {
  key: string;
  target: OpenTarget;
  name: string;
  /** Set for drawings: their format tile and download. */
  extension?: string;
  meta: string;
  status: { tone: "review" | "ok" | "none"; text: string } | null;
  summary?: ProjectSummary;
  file?: File;
  sample?: boolean;
}

const when = (iso: string) => new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export function ProjectLibrary({ variant, steps }: { variant: "page" | "column"; steps: number }) {
  const copy = useStrings().cad;
  const session = useCadSession();
  const { mode, library, project, drawings, busy } = session;
  const [query, setQuery] = useState("");
  const [dropping, setDropping] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const page = variant === "page";

  const rows = useMemo<Row[]>(() => {
    const sampleOpen = project?.key === SAMPLE_KEY;
    const open = sampleOpen ? openFindings(session.topology) : null;
    const sample: Row = {
      key: SAMPLE_KEY,
      target: { kind: "sample" },
      name: copy.sampleName,
      meta: SAMPLE_FILENAME,
      status: open === null ? null : open ? { tone: "review", text: copy.openFindingsCount(open) } : { tone: "ok", text: copy.reviewed },
      sample: true,
    };
    const saved: Row[] = library.projects.map((p) => {
      const upload = p.source.kind === "upload" ? p.source.original : null;
      return {
        key: p.id,
        target: { kind: "saved", id: p.id },
        name: p.name,
        extension: upload?.extension,
        meta: `${upload ? copy.format(upload.extension) : copy.preparedSample} · ${when(p.modifiedAt)}`,
        status: upload
          ? upload.available ? { tone: "none", text: copy.noExtraction } : { tone: "review", text: copy.originalMissing }
          : p.review?.openFindings ? { tone: "review", text: copy.openFindingsCount(p.review.openFindings) } : { tone: "ok", text: copy.reviewed },
        summary: p,
      };
    });
    const local: Row[] = drawings.map((d) => {
      const ext = d.file.name.split(".").pop()?.toLowerCase() ?? "";
      return { key: d.key, target: { kind: "drawing", key: d.key }, name: d.file.name, extension: ext, meta: `${copy.format(ext)} · ${formatBytes(d.file.size)}`, status: { tone: "none", text: copy.noExtraction }, file: d.file };
    });
    return [sample, ...saved, ...local];
  }, [copy, library.projects, drawings, project?.key, session.topology]);

  const shown = query.trim() ? rows.filter((row) => row.name.toLowerCase().includes(query.trim().toLowerCase())) : rows;
  const importFiles = (files: File[]) => void cad.importFiles(files, steps);

  return (
    <section
      className={`cad-library cad-library--${variant}${dropping ? " is-dropping" : ""}`}
      aria-labelledby={`cad-library-${variant}`}
      onDragOver={page ? (event) => { event.preventDefault(); setDropping(true); } : undefined}
      onDragLeave={page ? (event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false); } : undefined}
      onDrop={page ? (event) => { event.preventDefault(); setDropping(false); importFiles(Array.from(event.dataTransfer.files)); } : undefined}
    >
      <div className="cad-library__head">
        {page ? <h2 id={`cad-library-${variant}`}>{copy.projects} <span className="cad-library__count num">{rows.length}</span></h2>
          : <h3 id={`cad-library-${variant}`}>{copy.projects} <span className="cad-library__count num">{rows.length}</span></h3>}
        {mode === "demo" && <span className="tag-chip" title={copy.savingNeedsService}>{copy.thisTabOnly}</span>}
        <button
          type="button"
          className={page ? "button button--primary cad-library__import" : "icon-button"}
          onClick={() => input.current?.click()}
          disabled={busy === "upload"}
          aria-label={page ? undefined : copy.importDrawing}
          title={copy.importDrawing}
        >
          <FileUp size={page ? 16 : 17} aria-hidden="true" />
          {page && (busy === "upload" ? copy.importing : copy.importDrawing)}
        </button>
        <input ref={input} type="file" multiple hidden accept=".dwg,.dxf" onChange={(event) => {
          importFiles(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = "";
        }} />
      </div>
      <label className="field cad-library__search">
        <Search size={15} aria-hidden="true" />
        <input type="search" placeholder={copy.searchProjects} aria-label={copy.searchProjects} value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      {page && session.failure && (
        <div className="cad-library__notice" role="alert">
          <CircleAlert size={15} aria-hidden="true" />
          <span>{session.failure.message}</span>
          <button type="button" className="tool-button tool-button--text" onClick={cad.dismissFailure}>{copy.dismiss}</button>
        </div>
      )}
      {library.status === "unavailable" && (
        <div className="cad-library__notice" role="alert">
          <CircleAlert size={15} aria-hidden="true" />
          <span>{copy.serviceUnavailable}</span>
          <button type="button" className="tool-button tool-button--text" onClick={() => void cad.loadLibrary()}>
            <RotateCw size={14} aria-hidden="true" /> {copy.retry}
          </button>
        </div>
      )}
      <ul className="cad-library__list" aria-busy={library.status === "loading" || undefined}>
        {shown.map((row) => <LibraryRow key={row.key} row={row} steps={steps} />)}
        {library.status === "loading" && <li className="cad-library__empty">{copy.loadingProjects}</li>}
        {mode === "local" && library.status === "ready" && !library.projects.length && !query && <li className="cad-library__empty">{copy.noSavedProjects}</li>}
        {query && !shown.length && <li className="cad-library__empty">{copy.noMatches}</li>}
      </ul>
      {dropping && <div className="cad-library__drop" aria-hidden="true"><span>{copy.dropToImport}</span></div>}
    </section>
  );
}

function LibraryRow({ row, steps }: { row: Row; steps: number }) {
  const copy = useStrings().cad;
  const session = useCadSession();
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const box = useRef<HTMLLIElement>(null);
  const menuId = useId();
  const current = session.project?.key === row.key || (!!row.summary && session.project?.id === row.summary.id);
  const unsaved = current && isDirty(session);
  useEscapeLayer(menu, () => setMenu(false));
  useDismissOutside(menu, box, () => setMenu(false));
  const id = row.summary?.id;
  const download = row.extension ? (id ? (row.summary?.source.kind === "upload" && row.summary.source.original.available ? cad.originalUrl(id) : null) : row.file ? "file" : null) : null;
  const StatusIcon = row.status?.tone === "ok" ? CircleCheck : row.status?.tone === "review" ? CircleAlert : CircleMinus;

  const saveName = (name: string) => {
    setRenaming(false);
    const next = name.trim();
    if (next && id && next !== row.name) void cad.rename(next, id);
  };

  return (
    <li ref={box} className="cad-library__item">
      {renaming ? (
        <div className="cad-row cad-row--editing">
          <Thumbnail extension={row.extension} />
          <RenameField name={row.name} label={copy.renameProject} onDone={saveName} onCancel={() => setRenaming(false)} />
        </div>
      ) : (
        <button type="button" className="cad-row" aria-current={current || undefined} onClick={() => cad.request(row.target, steps)} disabled={session.busy === "open"}>
          <Thumbnail extension={row.extension} />
          <span className="cad-row__text">
            <span className="cad-row__name">
              <span>{row.name}</span>
              {unsaved ? <span className="cad-row__aside">{copy.unsavedChanges}</span> : current ? <span className="cad-row__aside">{copy.openNow}</span> : null}
            </span>
            {row.sample ? <span><span className="tag-chip cad-row__tag">{copy.preparedSample}</span></span> : <span className="cad-row__meta">{row.meta}</span>}
            {row.status && <span className={`cad-state cad-state--${row.status.tone}`}><StatusIcon size={13} aria-hidden="true" />{row.status.text}</span>}
          </span>
        </button>
      )}
      {(id || download) && !renaming && (
        <button type="button" className="icon-button cad-row__menu" aria-label={copy.projectActions(row.name)} aria-expanded={menu} aria-controls={menuId} onClick={() => setMenu(!menu)}>
          <MoreHorizontal size={16} aria-hidden="true" />
        </button>
      )}
      {menu && (
        <div id={menuId} className="cad-menu cad-menu--row">
          {id && <button type="button" onClick={() => { setMenu(false); setRenaming(true); }}>{copy.rename}</button>}
          {id && <button type="button" onClick={() => { setMenu(false); void cad.duplicate(id, copy.copyName(row.name)); }}>{copy.duplicate}</button>}
          {download && (download === "file"
            ? <button type="button" onClick={() => { setMenu(false); if (row.file) downloadFile(row.file); }}>{copy.downloadOriginal}</button>
            : <a href={download} download onClick={() => setMenu(false)}>{copy.downloadOriginal}</a>)}
          {id && <button type="button" className="cad-menu__danger" onClick={() => { setMenu(false); setConfirming(true); }}>{copy.deleteProject}</button>}
        </div>
      )}
      {confirming && id && (
        <ConfirmBox
          message={copy.deleteConfirm(row.name)}
          confirm={copy.delete}
          busy={session.busy === "delete"}
          onConfirm={() => { setConfirming(false); void cad.remove(id); }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </li>
  );
}

/** A drawing held in this tab (demo mode), saved through a short-lived object URL. */
export function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  Object.assign(document.createElement("a"), { href: url, download: file.name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** An inline name field: Enter keeps it, Escape (or leaving it empty) cancels. */
export function RenameField({ name, label, onDone, onCancel }: { name: string; label: string; onDone: (name: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const settled = useRef(false); // Enter, Escape or leaving the field: only the first counts
  const finish = (keep: boolean) => {
    if (settled.current) return;
    settled.current = true;
    if (keep && ref.current) onDone(ref.current.value);
    else onCancel();
  };
  useEscapeLayer(true, () => finish(false));
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="cad-rename"
      defaultValue={name}
      maxLength={120}
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish(true);
      }}
      onBlur={() => finish(true)}
    />
  );
}

/** An inline confirmation for a destructive choice: what will happen, then the choice (Cancel focused). */
export function ConfirmBox({ message, confirm, busy, onConfirm, onCancel }: { message: string; confirm: string; busy?: boolean; onConfirm: () => void; onCancel: () => void }) {
  const copy = useStrings().cad;
  const cancel = useRef<HTMLButtonElement>(null);
  useEscapeLayer(true, onCancel);
  useEffect(() => cancel.current?.focus(), []);
  return (
    <div className="cad-confirm" role="alertdialog" aria-label={confirm}>
      <p>{message}</p>
      <div className="cad-confirm__actions">
        <button type="button" className="button button--small cad-confirm__danger" onClick={onConfirm} disabled={busy}>{confirm}</button>
        <button ref={cancel} type="button" className="button button--small" onClick={onCancel} disabled={busy}>{copy.cancel}</button>
      </div>
    </div>
  );
}
