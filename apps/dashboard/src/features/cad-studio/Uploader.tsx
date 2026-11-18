/**
 * The one upload control: a button with its file chooser, and the drop handlers for an area.
 * Both send files to `cad.upload`, which accepts engineering drawings only (DWG, DXF) and puts
 * them in new projects (from Projects) or in the open project's history (a revision).
 */
import { useRef, useState, type DragEvent } from "react";
import { FileUp } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { cad, DRAWING_ACCEPT, useCadSession, type UploadTarget } from "./cadSession";

export function UploadAction({ into, label }: { into: UploadTarget; label: string }) {
  const copy = useStrings().cad;
  const { busy } = useCadSession();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className="cad-button cad-button--primary"
        onClick={() => input.current?.click()}
        disabled={!!busy}
        title={into === "projects" ? copy.uploadDrawingsTitle : copy.uploadRevisionTitle}
      >
        <FileUp size={15} aria-hidden="true" />
        {busy === "upload" ? copy.uploading : label}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept={DRAWING_ACCEPT}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          if (files.length) void cad.upload(files, into);
        }}
      />
    </>
  );
}

/** Drop drawings anywhere on an area: the same workflow as the button. */
export function useDropUpload(into: UploadTarget) {
  const [dropping, setDropping] = useState(false);
  const carriesFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
  return {
    dropping,
    handlers: {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        setDropping(true);
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        setDropping(false);
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (!files.length) return;
        event.preventDefault();
        void cad.upload(files, into);
      },
    },
  };
}

export function DropOverlay({ label }: { label: string }) {
  return (
    <div className="cad-drop" aria-hidden="true">
      <FileUp size={26} />
      <span>{label}</span>
    </div>
  );
}
