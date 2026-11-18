/**
 * The project header: back to the projects, the name (renamed in place), what it is and its
 * save state; the three views, Drawing | History | Compare; then Upload revision, Save (the
 * prepared sample's review; Ctrl+S), Preview in Overview and the project menu.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, DraftingCompass, Ellipsis, GitCompareArrows, History, MonitorPlay, Pencil } from "lucide-react";
import { useDismissOutside, useEscapeLayer } from "../../components/escape";
import { useStrings } from "../../lib/i18n";
import { cad, isDirty, useCadSession, type ProjectTab } from "./cadSession";
import { RenameField } from "./ProjectLibrary";
import { UploadAction } from "./Uploader";

const time = (iso: string) => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const TABS: { key: ProjectTab; Icon: typeof History }[] = [
  { key: "drawing", Icon: DraftingCompass },
  { key: "history", Icon: History },
  { key: "compare", Icon: GitCompareArrows },
];

export function Toolbar() {
  const copy = useStrings().cad;
  const session = useCadSession();
  const { project, mode, busy, failure, savedAt } = session;
  const [renaming, setRenaming] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const menuBox = useRef<HTMLDivElement>(null);
  useEscapeLayer(menu, () => setMenu(false));
  useDismissOutside(menu, menuBox, () => setMenu(false));

  const sample = project?.kind === "sample";
  const dirty = isDirty(session);
  const canSave = sample && !busy;
  const save = () => {
    if (!canSave || !project) return;
    if (project.id) void cad.save();
    else setPrompt(copy.newProjectName(copy.sampleName));
  };

  // Ctrl/Cmd+S saves (the browser's own page save would only save the dashboard).
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key.toLowerCase() !== "s" || !(event.ctrlKey || event.metaKey) || event.altKey) return;
      event.preventDefault();
      save();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!project) return null;
  const saveState = busy === "save" || busy === "copy" ? copy.saving
    : failure && !failure.conflict ? copy.notSaved
      : dirty ? copy.unsavedChanges
        : savedAt ? copy.savedAt(time(savedAt))
          : project.summary ? copy.savedAt(time(project.summary.modifiedAt)) : copy.notSaved;
  const stored = project.original && project.id && project.original.available ? cad.originalUrl(project.id) : null;
  const versions = project.summary?.versions ?? session.history.versions.length;

  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = TABS.findIndex((tab) => tab.key === session.tab);
    const next = event.key === "ArrowRight" ? (at + 1) % TABS.length : event.key === "ArrowLeft" ? (at + TABS.length - 1) % TABS.length : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    cad.setTab(TABS[next].key);
    document.getElementById(`cad-tab-${TABS[next].key}`)?.focus();
  };

  return (
    <header className="cad-head">
      <div className="cad-head__start">
        <button type="button" className="cad-icon-button" onClick={() => cad.close()} aria-label={copy.backToProjects} title={copy.backToProjects}>
          <ArrowLeft size={17} aria-hidden="true" />
        </button>
        <div className="cad-head__title">
          <h2 id="cad-project-name" className="cad-head__name" tabIndex={-1}>
            {renaming
              ? <RenameField name={project.name} label={copy.renameProject} onDone={(name) => { setRenaming(false); if (name.trim() && name.trim() !== project.name) void cad.rename(name.trim()); }} onCancel={() => setRenaming(false)} />
              : (
                <button type="button" onClick={() => setRenaming(true)} title={copy.rename} disabled={busy === "rename"}>
                  <span>{project.name}</span>
                  <Pencil size={13} aria-hidden="true" />
                </button>
              )}
          </h2>
          <span className="cad-head__meta">
            <span className="cad-tag">{sample ? copy.preparedSample : copy.format(project.original?.extension ?? "")}</span>
            {mode === "demo" && <span className="cad-tag cad-tag--quiet" title={copy.savingNeedsService}>{copy.thisTabOnly}</span>}
            <span className="cad-head__state" role="status">{sample ? saveState : copy.versionsCount(versions)}</span>
          </span>
        </div>
      </div>

      <div className="cad-tabs" role="tablist" aria-label={copy.projectViews} onKeyDown={onTabKey}>
        {TABS.map(({ key, Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`cad-tab-${key}`}
            className="cad-tab"
            aria-selected={session.tab === key}
            aria-controls="cad-tabpanel"
            tabIndex={session.tab === key ? 0 : -1}
            onClick={() => cad.setTab(key)}
          >
            <Icon size={15} aria-hidden="true" />
            <span>{copy.tabs[key]}</span>
            {key === "history" && versions > 0 && <span className="cad-tab__count num">{versions}</span>}
          </button>
        ))}
      </div>

      <div className="cad-head__end">
        {sample && (
          <button type="button" className="cad-icon-button" onClick={() => cad.show("preview")} aria-label={copy.previewOverview} title={copy.previewOverview}>
            <MonitorPlay size={16} aria-hidden="true" />
          </button>
        )}
        {sample && (
          <button type="button" className={`cad-button${dirty && canSave ? " cad-button--accent" : ""}`} onClick={save} disabled={!canSave}>
            {busy === "save" ? copy.saving : copy.save}
          </button>
        )}
        <UploadAction into="revision" label={copy.upload} />
        <div ref={menuBox} className="cad-head__menu">
          <button type="button" className="cad-icon-button" aria-haspopup="true" aria-expanded={menu} onClick={() => setMenu(!menu)} aria-label={copy.file} title={copy.file}>
            <Ellipsis size={17} aria-hidden="true" />
          </button>
          {menu && (
            <div className="cad-menu cad-menu--file">
              <button type="button" onClick={() => { setMenu(false); setRenaming(true); }}>{copy.rename}</button>
              {sample && <button type="button" disabled={!!busy} onClick={() => { setMenu(false); setPrompt(project.id ? copy.copyName(project.name) : copy.newProjectName(copy.sampleName)); }}>{copy.saveAs}</button>}
              {project.id && <button type="button" disabled={!!busy} onClick={() => { setMenu(false); void cad.duplicate(project.id!, copy.copyName(project.name)); }}>{copy.duplicate}</button>}
              {stored && <a href={stored} download={project.original?.name} onClick={() => setMenu(false)}>{copy.downloadOriginal}</a>}
              {dirty && <button type="button" onClick={() => { setMenu(false); cad.revert(); }}>{copy.revert}</button>}
              <button type="button" onClick={() => { setMenu(false); cad.close(); }}>{copy.closeProject}</button>
            </div>
          )}
        </div>
      </div>
      {prompt !== null && (
        <NamePrompt
          title={copy.saveAsTitle}
          initial={prompt}
          onCancel={() => setPrompt(null)}
          onSubmit={(name) => {
            setPrompt(null);
            void (project.id ? cad.saveAs(name) : cad.save(name));
          }}
        />
      )}
    </header>
  );
}

/** Save As: the new project's name, then Save or Cancel. */
function NamePrompt({ title, initial, onSubmit, onCancel }: { title: string; initial: string; onSubmit: (name: string) => void; onCancel: () => void }) {
  const copy = useStrings().cad;
  const field = useRef<HTMLInputElement>(null);
  useEscapeLayer(true, onCancel);
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);
  return (
    <form
      className="cad-prompt"
      role="dialog"
      aria-label={title}
      onSubmit={(event) => {
        event.preventDefault();
        const name = field.current?.value.trim();
        if (name) onSubmit(name);
      }}
    >
      <label className="cad-prompt__field">
        {copy.projectName}
        <input ref={field} name="project-name" autoComplete="off" defaultValue={initial} maxLength={120} required />
      </label>
      <div className="cad-prompt__actions">
        <button type="submit" className="cad-button cad-button--primary">{copy.save}</button>
        <button type="button" className="cad-button" onClick={onCancel}>{copy.cancel}</button>
      </div>
    </form>
  );
}
