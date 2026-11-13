/** A drawing project: what the file is and where its original is. No extraction exists, so there is no preview. */
import { Download } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { cad, useCadSession } from "./cadSession";
import { downloadFile } from "./ProjectLibrary";
import { formatBytes } from "./review";
import { Thumbnail } from "./Thumbnail";

const date = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

export function FileSheet() {
  const copy = useStrings().cad;
  const { project } = useCadSession();
  const original = project?.original;
  if (!project || !original) return null;
  const sheet = copy.fileSheet;
  const stored = project.id && original.available ? cad.originalUrl(project.id) : null;
  return (
    <section className="cad-file" aria-labelledby="cad-file-title">
      <div className="cad-file__card">
        <Thumbnail extension={original.extension} />
        <h3 id="cad-file-title">{original.name}</h3>
        <span className="tag-chip">{copy.noExtraction}</span>
        <dl className="cad-file__facts">
          <div><dt>{sheet.format}</dt><dd>{copy.format(original.extension)}</dd></div>
          <div><dt>{sheet.size}</dt><dd>{formatBytes(original.sizeBytes)}</dd></div>
          {project.summary && <div><dt>{sheet.added}</dt><dd>{date(project.summary.createdAt)}</dd></div>}
          <div><dt>{sheet.original}</dt><dd>{project.id ? (original.available ? sheet.stored : sheet.missing) : sheet.thisTab}</dd></div>
        </dl>
        {stored ? (
          <a className="button" href={stored} download={original.name}><Download size={15} aria-hidden="true" />{copy.downloadOriginal}</a>
        ) : original.file ? (
          <button type="button" className="button" onClick={() => downloadFile(original.file!)}><Download size={15} aria-hidden="true" />{copy.downloadOriginal}</button>
        ) : null}
      </div>
    </section>
  );
}
