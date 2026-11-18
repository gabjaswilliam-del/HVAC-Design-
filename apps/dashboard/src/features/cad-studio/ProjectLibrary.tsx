/**
 * Projects: where CAD Studio opens. Upload drawing is the one primary action (the shared
 * uploader; a drawing dropped anywhere on the page uploads too); the prepared sample is pinned
 * first, then every project by when it was last opened, each with its preview, versions, date
 * and review state. Search narrows them. Every project is a drawing (DWG or DXF, or the
 * prepared sample's review), so there is no file-type filter.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { BadgeCheck, CircleAlert, CircleCheck, CircleMinus, Ellipsis, Plus, RotateCw, Search } from "lucide-react";
import type { ProjectSummary } from "../../lib/contracts/cadProject";
import { useStrings } from "../../lib/i18n";
import { useDismissOutside, useEscapeLayer } from "../../components/escape";
import { cad, isDirty, openFindings, SAMPLE_FILENAME, SAMPLE_KEY, useCadSession, type OpenTarget } from "./cadSession";
import { Thumbnail } from "./Thumbnail";
import { DropOverlay, UploadAction, useDropUpload } from "./Uploader";

interface Card {
  key: string;
  target: OpenTarget;
  name: string;
  /** Set for uploaded drawings: their format tile and download. */
  extension?: string;
  meta: string;
  status: { tone: "review" | "ok" | "none"; text: string } | null;
  summary?: ProjectSummary;
  sample?: boolean;
}

const when = (iso: string) => new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export function ProjectLibrary({ steps }: { steps: number }) {
  const copy = useStrings().cad;
  const session = useCadSession();
  const { mode, library, project } = session;
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const drop = useDropUpload("projects");

  const cards = useMemo<Card[]>(() => {
    const sampleOpen = project?.key === SAMPLE_KEY;
    const open = sampleOpen ? openFindings(session.topology) : null;
    const sample: Card = {
      key: SAMPLE_KEY,
      target: { kind: "sample" },
      name: copy.sampleName,
      meta: SAMPLE_FILENAME,
      status: open === null ? null : open ? { tone: "review", text: copy.openFindingsCount(open) } : { tone: "ok", text: copy.reviewed },
      sample: true,
    };
    const saved: Card[] = library.projects.map((p) => {
      const upload = p.source.kind === "upload" ? p.source.original : null;
      return {
        key: p.id,
        target: { kind: "saved", id: p.id },
        name: p.name,
        extension: upload?.extension,
        meta: `${copy.versionsCount(p.versions)} · ${when(p.modifiedAt)}`,
        status: upload
          ? upload.available ? { tone: "none", text: copy.noExtraction } : { tone: "review", text: copy.originalMissing }
          : p.review?.openFindings ? { tone: "review", text: copy.openFindingsCount(p.review.openFindings) } : { tone: "ok", text: copy.reviewed },
        summary: p,
      };
    });
    return [sample, ...saved];
  }, [copy, library.projects, project?.key, session.topology]);

  const needle = query.trim().toLowerCase();
  const shown = needle ? cards.filter((card) => card.name.toLowerCase().includes(needle)) : cards;

  return (
    <section className={`cad-home${drop.dropping ? " is-dropping" : ""}`} aria-labelledby="cad-home-title" {...drop.handlers}>
      <header className="cad-home__head">
        <h2 id="cad-home-title">{copy.projects} <span className="cad-home__count num">{cards.length}</span></h2>
        {mode === "demo" && <span className="cad-tag cad-tag--quiet" title={copy.savingNeedsService}>{copy.thisTabOnly}</span>}
        <label className="cad-search">
          <Search size={15} aria-hidden="true" />
          <input type="search" placeholder={copy.searchProjects} aria-label={copy.searchProjects} value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button type="button" className="cad-icon-button cad-icon-button--outlined" onClick={() => setCreating(true)} aria-label={copy.newProject} title={copy.newProjectTitle}>
          <Plus size={17} aria-hidden="true" />
        </button>
        <UploadAction into="projects" label={copy.uploadDrawing} />
      </header>

      {session.failure && (
        <div className="cad-notice" role="alert">
          <CircleAlert size={15} aria-hidden="true" />
          <span>{session.failure.message}</span>
          <button type="button" className="cad-text-button" onClick={cad.dismissFailure}>{copy.dismiss}</button>
        </div>
      )}
      {library.status === "unavailable" && (
        <div className="cad-notice" role="alert">
          <CircleAlert size={15} aria-hidden="true" />
          <span>{copy.serviceUnavailable}</span>
          <button type="button" className="cad-text-button" onClick={() => void cad.loadLibrary()}><RotateCw size={14} aria-hidden="true" /> {copy.retry}</button>
        </div>
      )}

      <ul className="cad-grid-cards" aria-busy={library.status === "loading" || undefined}>
        {shown.map((card) => <ProjectCard key={card.key} card={card} steps={steps} />)}
      </ul>
      {library.status === "loading" && <p className="cad-home__empty" role="status">{copy.loadingProjects}</p>}
      {needle && !shown.length && <p className="cad-home__empty">{copy.noMatches}</p>}

      {creating && <NewProjectForm onCancel={() => setCreating(false)} onSubmit={(name) => { setCreating(false); void cad.newProject(name, steps); }} />}
      {drop.dropping && <DropOverlay label={copy.dropToUpload} />}
    </section>
  );
}

function NewProjectForm({ onCancel, onSubmit }: { onCancel: () => void; onSubmit: (name: string) => void }) {
  const copy = useStrings().cad;
  const field = useRef<HTMLInputElement>(null);
  useEscapeLayer(true, onCancel);
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);
  return (
    <form className="cad-prompt" role="dialog" aria-label={copy.newProject} onSubmit={(event) => {
      event.preventDefault();
      const name = field.current?.value.trim();
      if (name) onSubmit(name);
    }}>
      <label className="cad-prompt__field">
        {copy.projectName}
        <input ref={field} name="project-name" autoComplete="off" defaultValue={copy.newProjectName(copy.sampleName)} maxLength={120} required />
      </label>
      <div className="cad-prompt__actions">
        <button type="submit" className="cad-button cad-button--primary">{copy.createProject}</button>
        <button type="button" className="cad-button" onClick={onCancel}>{copy.cancel}</button>
      </div>
    </form>
  );
}

function ProjectCard({ card, steps }: { card: Card; steps: number }) {
  const copy = useStrings().cad;
  const session = useCadSession();
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const box = useRef<HTMLLIElement>(null);
  const menuId = useId();
  const current = session.project?.key === card.key;
  const unsaved = current && isDirty(session);
  useEscapeLayer(menu, () => setMenu(false));
  useDismissOutside(menu, box, () => setMenu(false));
  const id = card.summary?.id;
  const download = id && card.summary?.source.kind === "upload" && card.summary.source.original.available ? cad.originalUrl(id) : null;
  const StatusIcon = card.status?.tone === "ok" ? CircleCheck : card.status?.tone === "review" ? CircleAlert : CircleMinus;

  const saveName = (name: string) => {
    setRenaming(false);
    const next = name.trim();
    if (next && id && next !== card.name) void cad.rename(next, id);
  };

  return (
    <li ref={box} className="cad-card-item">
      <button type="button" className="cad-card" aria-current={current || undefined} onClick={() => !renaming && cad.request(card.target, steps)} disabled={session.busy === "open"}>
        <span className="cad-card__preview"><Thumbnail extension={card.extension} /></span>
        <span className="cad-card__body">
          <span className="cad-card__name">{renaming ? "" : card.name}</span>
          <span className="cad-card__meta">{card.sample ? <span className="cad-tag">{copy.preparedSample}</span> : card.meta}</span>
          <span className="cad-card__foot">
            {card.status && <span className={`cad-state cad-state--${card.status.tone}`}><StatusIcon size={13} aria-hidden="true" />{card.status.text}</span>}
            {card.summary?.referenceVersionId && <span className="cad-ref-badge" title={copy.approvedReference}><BadgeCheck size={14} aria-hidden="true" /><span className="visually-hidden">{copy.approvedReference}</span></span>}
            {unsaved ? <span className="cad-card__aside">{copy.unsavedChanges}</span> : current ? <span className="cad-card__aside">{copy.openNow}</span> : null}
          </span>
        </span>
      </button>
      {renaming && <div className="cad-card__rename"><RenameField name={card.name} label={copy.renameProject} onDone={saveName} onCancel={() => setRenaming(false)} /></div>}
      {id && !renaming && (
        <button type="button" className="cad-icon-button cad-card__menu" aria-label={copy.projectActions(card.name)} aria-expanded={menu} aria-controls={menuId} onClick={() => setMenu(!menu)}>
          <Ellipsis size={16} aria-hidden="true" />
        </button>
      )}
      {menu && id && (
        <div id={menuId} className="cad-menu cad-menu--card">
          <button type="button" onClick={() => { setMenu(false); setRenaming(true); }}>{copy.rename}</button>
          <button type="button" onClick={() => { setMenu(false); void cad.duplicate(id, copy.copyName(card.name)); }}>{copy.duplicate}</button>
          {download && <a href={download} download={card.summary?.source.kind === "upload" ? card.summary.source.original.name : undefined} onClick={() => setMenu(false)}>{copy.downloadOriginal}</a>}
          <button type="button" className="cad-menu__danger" onClick={() => { setMenu(false); setConfirming(true); }}>{copy.deleteProject}</button>
        </div>
      )}
      {confirming && id && (
        <ConfirmBox
          message={copy.deleteConfirm(card.name)}
          confirm={copy.delete}
          busy={session.busy === "delete"}
          onConfirm={() => { setConfirming(false); void cad.remove(id); }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </li>
  );
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
      name="rename-project"
      autoComplete="off"
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

/** An inline confirmation: what will happen, then the choice (Cancel focused). */
export function ConfirmBox({ message, confirm, busy, tone = "danger", onConfirm, onCancel }: { message: string; confirm: string; busy?: boolean; tone?: "danger" | "primary"; onConfirm: () => void; onCancel: () => void }) {
  const copy = useStrings().cad;
  const cancel = useRef<HTMLButtonElement>(null);
  useEscapeLayer(true, onCancel);
  useEffect(() => cancel.current?.focus(), []);
  return (
    <div className="cad-confirm" role="alertdialog" aria-label={confirm}>
      <p>{message}</p>
      <div className="cad-confirm__actions">
        <button type="button" className={`cad-button ${tone === "danger" ? "cad-button--danger" : "cad-button--primary"}`} onClick={onConfirm} disabled={busy}>{confirm}</button>
        <button ref={cancel} type="button" className="cad-button" onClick={onCancel} disabled={busy}>{copy.cancel}</button>
      </div>
    </div>
  );
}
