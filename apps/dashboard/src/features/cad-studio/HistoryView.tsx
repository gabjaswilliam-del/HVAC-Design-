/**
 * A project's history, newest first: the working review (the prepared sample's, while it is
 * being edited) and every saved version, an uploaded revision or a frozen review. One version
 * may be the approved reference; it is chosen here, explicitly, and a new version never moves it.
 */
import { useState } from "react";
import { BadgeCheck, CircleAlert, CircleCheck, CircleMinus, Download, Eye, GitCompareArrows, Save, Stamp } from "lucide-react";
import type { ProjectVersion } from "../../lib/contracts/cadProject";
import { useStrings } from "../../lib/i18n";
import { cad, isDirty, openFindings, referenceId, useCadSession, WORKING } from "./cadSession";
import { dateTime } from "./FileSheet";
import { ConfirmBox } from "./ProjectLibrary";
import { formatBytes } from "./review";
import { Thumbnail } from "./Thumbnail";

type Copy = ReturnType<typeof useStrings>["cad"];

/** "Version 3 · rev-c.dxf", or the version's own label. */
export const versionTitle = (version: ProjectVersion, copy: Copy) =>
  version.label ?? (version.source.kind === "upload" ? version.source.original.name : copy.version(version.number));

/** "Version 2", or "Version 2 · rev-b.dwg" when the version has a name of its own. */
export const versionName = (version: ProjectVersion, copy: Copy) => {
  const title = versionTitle(version, copy);
  return title === copy.version(version.number) ? title : `${copy.version(version.number)} · ${title}`;
};

/** The revision mark: a drafting delta with the version number. */
export function Delta({ number, reference = false }: { number: number | null; reference?: boolean }) {
  return (
    <span className={`cad-delta${reference ? " is-reference" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 28 24"><path d="M14 2 L26 22 L2 22 Z" /></svg>
      <span className="num">{number ?? "·"}</span>
    </span>
  );
}

function Status({ version }: { version: ProjectVersion }) {
  const copy = useStrings().cad;
  if (version.source.kind === "upload") {
    return version.source.original.available
      ? <span className="cad-state cad-state--none"><CircleMinus size={13} aria-hidden="true" />{copy.noExtraction}</span>
      : <span className="cad-state cad-state--review"><CircleAlert size={13} aria-hidden="true" />{copy.originalMissing}</span>;
  }
  const open = version.review?.openFindings ?? 0;
  return open
    ? <span className="cad-state cad-state--review"><CircleAlert size={13} aria-hidden="true" />{copy.openFindingsCount(open)}</span>
    : <span className="cad-state cad-state--ok"><CircleCheck size={13} aria-hidden="true" />{copy.reviewed}</span>;
}

export function HistoryView() {
  const copy = useStrings().cad;
  const session = useCadSession();
  const { project, history, busy } = session;
  const [confirm, setConfirm] = useState<ProjectVersion | null>(null);
  if (!project) return null;
  const sample = project.kind === "sample";
  const reference = referenceId(session);
  const versions = [...history.versions].reverse();
  const current = history.versions.find((v) => v.id === reference);
  const choose = (version: ProjectVersion) => (reference && reference !== version.id ? setConfirm(version) : void cad.setReference(version.id));
  const open = openFindings(session.topology);
  const dirty = isDirty(session);

  return (
    <section className="cad-history" aria-labelledby="cad-history-title">
      <header className="cad-history__head">
        <h3 id="cad-history-title">{copy.history}</h3>
        <span className="cad-history__count num">{copy.versionsCount(history.versions.length)}</span>
        <span className="cad-history__spacer" />
        {sample && (
          <button type="button" className="cad-button" disabled={!!busy} onClick={() => void cad.saveVersion(copy.newProjectName(copy.sampleName))}>
            <Save size={15} aria-hidden="true" />{busy === "version" ? copy.savingVersion : copy.saveVersion}
          </button>
        )}
      </header>

      <ol className="cad-timeline">
        {sample && (
          <li className="cad-version cad-version--working" aria-current={!session.viewing ? "true" : undefined}>
            <Delta number={null} />
            <Thumbnail />
            <span className="cad-version__text">
              <span className="cad-version__name">{copy.workingReview}</span>
              <span className="cad-version__meta">{dirty ? copy.unsavedChanges : session.savedAt ? copy.savedAt(dateTime(session.savedAt)) : project.summary ? copy.savedAt(dateTime(project.summary.modifiedAt)) : copy.notSaved}</span>
            </span>
            <span className="cad-version__status">
              {open ? <span className="cad-state cad-state--review"><CircleAlert size={13} aria-hidden="true" />{copy.openFindingsCount(open)}</span> : <span className="cad-state cad-state--ok"><CircleCheck size={13} aria-hidden="true" />{copy.reviewed}</span>}
            </span>
            <span className="cad-version__actions">
              <button type="button" className="cad-icon-button" onClick={() => cad.viewVersion(null)} aria-label={copy.openVersion(copy.workingReview)} title={copy.openVersion(copy.workingReview)}><Eye size={16} aria-hidden="true" /></button>
              <button type="button" className="cad-icon-button" disabled={!history.versions.length} onClick={() => cad.compareWith(WORKING)} aria-label={copy.compareVersion(copy.workingReview)} title={copy.compareVersion(copy.workingReview)}><GitCompareArrows size={16} aria-hidden="true" /></button>
            </span>
          </li>
        )}
        {versions.map((version) => {
          const title = versionTitle(version, copy);
          const isReference = version.id === reference;
          const url = version.source.kind === "upload" && version.source.original.available ? cad.versionUrl(version.id) : null;
          return (
            <li key={version.id} className={`cad-version${isReference ? " is-reference" : ""}`} aria-current={session.viewing === version.id ? "true" : undefined}>
              <Delta number={version.number} reference={isReference} />
              <Thumbnail extension={version.source.kind === "upload" ? version.source.original.extension : undefined} />
              <span className="cad-version__text">
                <span className="cad-version__name">{title}</span>
                <span className="cad-version__meta">
                  {version.label || version.source.kind === "upload" ? `${copy.version(version.number)} · ` : ""}
                  {dateTime(version.createdAt)}
                  {version.source.kind === "upload" ? ` · ${formatBytes(version.source.original.sizeBytes)}` : ""}
                </span>
              </span>
              <span className="cad-version__status">
                {isReference && <span className="cad-ref-badge"><BadgeCheck size={14} aria-hidden="true" />{copy.approvedReference}</span>}
                <Status version={version} />
              </span>
              <span className="cad-version__actions">
                <button type="button" className="cad-icon-button" onClick={() => cad.viewVersion(version.id)} aria-label={copy.openVersion(title)} title={copy.openVersion(title)}><Eye size={16} aria-hidden="true" /></button>
                <button type="button" className="cad-icon-button" onClick={() => cad.compareWith(version.id)} disabled={isReference && history.versions.length < 2 && !sample} aria-label={copy.compareVersion(title)} title={copy.compareVersion(title)}><GitCompareArrows size={16} aria-hidden="true" /></button>
                {url && <a className="cad-icon-button" href={url} download={version.source.kind === "upload" ? version.source.original.name : undefined} aria-label={copy.downloadVersion(title)} title={copy.downloadVersion(title)}><Download size={16} aria-hidden="true" /></a>}
                {isReference
                  ? <button type="button" className="cad-text-button" disabled={!!busy} onClick={() => void cad.setReference(null)}>{copy.clearReference}</button>
                  : <button type="button" className="cad-icon-button" disabled={!!busy || !project.id} onClick={() => choose(version)} aria-label={copy.setReferenceFor(title)} title={copy.setReference}><Stamp size={16} aria-hidden="true" /></button>}
              </span>
            </li>
          );
        })}
      </ol>

      {!history.versions.length && history.status !== "loading" && (
        <div className="cad-empty-state">
          <strong>{copy.noVersions}</strong>
          <span>{history.status === "unavailable" ? copy.historyUnavailable : sample ? copy.noVersionsSample : copy.noVersionsDrawing}</span>
        </div>
      )}
      {confirm && current && (
        <ConfirmBox
          message={copy.changeReferenceConfirm(copy.version(confirm.number), copy.version(current.number))}
          confirm={copy.setReference}
          tone="primary"
          busy={busy === "reference"}
          onConfirm={() => { setConfirm(null); void cad.setReference(confirm.id); }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </section>
  );
}
