/**
 * The workbench toolbar: the document (Projects, its name, what it is, its save state, Save and
 * File), the view switch, and Preview in Overview. Only working controls; Save is laminate only
 * while there are unsaved changes.
 */
import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown, FileText, Layers as LayersIcon, PanelLeft, Pencil, Square } from "lucide-react";
import { RadioGroup } from "../../components/RadioGroup";
import { useDismissOutside, useEscapeLayer } from "../../components/escape";
import { useStrings } from "../../lib/i18n";
import type { WorkspaceState } from "../../lib/contracts/cadProject";
import { cad, isDirty, useCadSession, type StudioView } from "./cadSession";
import { downloadFile, RenameField } from "./ProjectLibrary";

const time = (iso: string) => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export function Toolbar({ libraryShown, onProjects, columnToggle }: {
  libraryShown: boolean;
  onProjects: () => void;
  /** The Projects button shows or hides a column (else it goes to the Library page). */
  columnToggle: boolean;
}) {
  const copy = useStrings().cad;
  const session = useCadSession();
  const { project, mode, busy, failure, savedAt, view } = session;
  const [renaming, setRenaming] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const menuBox = useRef<HTMLDivElement>(null);
  useEscapeLayer(menu, () => setMenu(false));
  useDismissOutside(menu, menuBox, () => setMenu(false));

  const local = mode === "local";
  const sample = project?.kind === "sample";
  const dirty = isDirty(session);
  const canSave = local && sample && !busy;
  const save = () => {
    if (!canSave || !project) return;
    if (project.id) void cad.save();
    else setPrompt(copy.newProjectName(copy.sampleName));
  };

  // Ctrl/Cmd+S saves (the browser's own page save would only save the dashboard).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "s" || !(event.ctrlKey || event.metaKey) || event.altKey) return;
      event.preventDefault();
      save();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!project) return null;
  const saveState = !local
    ? dirty ? copy.unsavedChanges : copy.thisTabOnly
    : busy === "save" || busy === "copy" ? copy.saving
      : failure && !failure.conflict ? copy.notSaved
        : dirty ? copy.unsavedChanges
          : savedAt ? copy.savedAt(time(savedAt))
            : project.summary ? copy.savedAt(time(project.summary.modifiedAt)) : copy.notSaved;
  const stored = project.original && project.id && project.original.available ? cad.originalUrl(project.id) : null;
  const inTab = project.original?.file ?? null;

  return (
    <header className="cad-tb">
      <div className="cad-tb__doc">
        <button type="button" className="tool-button tool-button--text cad-tb__projects" aria-expanded={columnToggle ? libraryShown : undefined} onClick={onProjects} title={copy.projects}>
          <PanelLeft size={16} aria-hidden="true" />
          <span className="cad-tb__label">{copy.projects}</span>
        </button>
        <span className="cad-tb__sep" aria-hidden="true" />
        <div className="cad-tb__title">
          <h2 id="cad-project-name" className="cad-tb__name" tabIndex={-1}>
            {renaming
              ? <RenameField name={project.name} label={copy.renameProject} onDone={(name) => { setRenaming(false); if (name.trim() && name.trim() !== project.name) void cad.rename(name.trim()); }} onCancel={() => setRenaming(false)} />
              : !columnToggle ? <span className="cad-tb__name-text">{project.name}</span>
              : (
                <button type="button" onClick={() => setRenaming(true)} title={copy.rename} disabled={busy === "rename"}>
                  <span>{project.name}</span>
                  <Pencil size={14} aria-hidden="true" />
                </button>
              )}
          </h2>
          <span className="cad-tb__ident">
            <span className="tag-chip">{sample ? copy.preparedSample : copy.format(project.original?.extension ?? "")}</span>
            <span className="cad-tb__state" role="status">{saveState}</span>
          </span>
        </div>
        <button
          type="button"
          className={`button cad-tb__save${dirty && canSave ? " button--primary" : ""}`}
          onClick={save}
          disabled={!canSave}
          title={!local ? copy.savingNeedsService : undefined}
        >
          {busy === "save" ? copy.saving : copy.save}
        </button>
        <div ref={menuBox} className="cad-tb__file">
          <button type="button" className="tool-button tool-button--text" aria-haspopup="true" aria-expanded={menu} onClick={() => setMenu(!menu)} aria-label={copy.file}>
            <FileText size={16} aria-hidden="true" className="cad-tb__narrow" />
            <span className="cad-tb__label">{copy.file}</span>
            <ChevronDown size={14} aria-hidden="true" className="cad-tb__label" />
          </button>
          {menu && (
            <div className="cad-menu cad-menu--file">
              {!columnToggle && <button type="button" onClick={() => { setMenu(false); setRenaming(true); }}>{copy.rename}</button>}
              {local && sample && <button type="button" disabled={!!busy} onClick={() => { setMenu(false); setPrompt(project.id ? copy.copyName(project.name) : copy.newProjectName(copy.sampleName)); }}>{copy.saveAs}</button>}
              {local && project.id && <button type="button" disabled={!!busy} onClick={() => { setMenu(false); void cad.duplicate(project.id!, copy.copyName(project.name)); }}>{copy.duplicate}</button>}
              {stored && <a href={stored} download={project.original?.name} onClick={() => setMenu(false)}>{copy.downloadOriginal}</a>}
              {!stored && inTab && <button type="button" onClick={() => { setMenu(false); downloadFile(inTab); }}>{copy.downloadOriginal}</button>}
              {dirty && <button type="button" onClick={() => { setMenu(false); cad.revert(); }}>{copy.revert}</button>}
              <button type="button" onClick={() => { setMenu(false); cad.close(); }}>{copy.closeProject}</button>
            </div>
          )}
        </div>
      </div>
      {sample && (
        <div className="cad-tb__views">
          <RadioGroup<StudioView>
            label={copy.viewSwitch}
            value={view}
            options={(["drawing", "model", "compare"] as StudioView[]).map((value) => ({ value, label: copy.viewNames[value] }))}
            onChange={cad.setView}
          />
        </div>
      )}
      {sample && view === "model" && (
        <div className="cad-tb__aux">
          <button type="button" className="tool-button tool-button--text" onClick={() => cad.setPreset("plan")} title={copy.planView}>
            <Square size={14} aria-hidden="true" />
            <span>{copy.planView}</span>
          </button>
          <details className="cad-layers">
            <summary className="tool-button tool-button--text" title={copy.layers}><LayersIcon size={14} aria-hidden="true" /><span>{copy.layers}</span></summary>
            <fieldset className="cad-layers__menu">
              <legend>{copy.layers}</legend>
              {(Object.keys(copy.layerNames) as (keyof WorkspaceState["layers"])[]).map((layer) => (
                <label key={layer}>
                  <input type="checkbox" checked={session.layers[layer]} onChange={(event) => cad.setLayer(layer, event.target.checked)} />
                  {copy.layerNames[layer]}
                </label>
              ))}
            </fieldset>
          </details>
          <RadioGroup<WorkspaceState["colourBy"]>
            label={copy.colourBy}
            value={session.colourBy}
            options={[{ value: "medium", label: copy.colourMedium }, { value: "review", label: copy.colourReview }]}
            onChange={cad.setColourBy}
          />
        </div>
      )}
      {sample && (
        <div className="cad-tb__end">
          {view === "model" && <span className="tag-chip cad-tb__model" title={copy.schematicModelTitle}>{copy.schematicModel}</span>}
          <button type="button" className="button cad-tb__preview" onClick={() => cad.show("preview")} aria-label={copy.previewOverview}>
            <span>{copy.previewOverview}</span>
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      )}
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
        <input ref={field} defaultValue={initial} maxLength={120} required />
      </label>
      <div className="cad-prompt__actions">
        <button type="submit" className="button button--primary button--small">{copy.save}</button>
        <button type="button" className="button button--small" onClick={onCancel}>{copy.cancel}</button>
      </div>
    </form>
  );
}
