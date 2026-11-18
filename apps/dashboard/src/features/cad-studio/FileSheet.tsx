/** An uploaded drawing: what the file is and where its original is. It is never parsed, so there is no preview. */
import { Download } from "lucide-react";
import type { ReactNode } from "react";
import { useStrings } from "../../lib/i18n";
import { formatBytes } from "./review";
import { Thumbnail } from "./Thumbnail";

export const dateTime = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

export interface DrawingFile {
  name: string;
  extension: string;
  sizeBytes: number;
  available: boolean;
  addedAt?: string;
  /** Where the exact original downloads from (null: missing). */
  url: string | null;
}

export function FileSheet({ file, caption }: { file: DrawingFile; caption?: ReactNode }) {
  const copy = useStrings().cad;
  const sheet = copy.fileSheet;
  return (
    <section className="cad-file" aria-labelledby="cad-file-title">
      <div className="cad-file__card">
        <Thumbnail extension={file.extension} />
        {caption}
        <h3 id="cad-file-title">{file.name}</h3>
        <span className="cad-tag">{copy.noExtraction}</span>
        <dl className="cad-file__facts">
          <div><dt>{sheet.format}</dt><dd>{copy.format(file.extension)}</dd></div>
          <div><dt>{sheet.size}</dt><dd>{formatBytes(file.sizeBytes)}</dd></div>
          {file.addedAt && <div><dt>{sheet.added}</dt><dd>{dateTime(file.addedAt)}</dd></div>}
          <div><dt>{sheet.original}</dt><dd>{file.available ? sheet.stored : sheet.missing}</dd></div>
        </dl>
        {file.url && <a className="cad-button" href={file.url} download={file.name}><Download size={15} aria-hidden="true" />{copy.downloadOriginal}</a>}
      </div>
    </section>
  );
}
