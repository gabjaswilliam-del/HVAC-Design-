/**
 * Pieces both Knowledge tabs use. Retrieved passages and memory text are untrusted data:
 * they are rendered as text nodes only (React escapes them), never as markup.
 */
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useKnowledgeStrings } from "../../lib/i18n/knowledge";
import { motion } from "../../lib/motion";
import { useEscapeLayer } from "../../components/escape";
import { knowledgeMode } from "../../app/dataClient";

/** Text with highlighted ranges, as plain text and <mark> elements. */
export function Highlighted({ text, ranges, className }: { text: string; ranges: readonly (readonly [number, number])[]; className?: string }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) {
    if (a < at || a >= b) continue;
    if (a > at) parts.push(text.slice(at, a));
    parts.push(<mark key={a}>{text.slice(a, b)}</mark>);
    at = b;
  }
  parts.push(text.slice(at));
  return <span className={className}>{parts}</span>;
}

/** An evidence snippet: its span highlighted, with ellipses where the passage goes on. */
export function Snippet({ snippet }: { snippet: { text: string; highlight: readonly [number, number]; before: boolean; after: boolean } | null }) {
  const s = useKnowledgeStrings();
  if (!snippet) return <span className="kn-muted">{s.evidence.noSnippet}</span>;
  return (
    <q className="kn-snippet">
      {snippet.before && "… "}
      <Highlighted text={snippet.text} ranges={[snippet.highlight]} />
      {snippet.after && " …"}
    </q>
  );
}

/** Which store the tab shows: the demo's, read only, or the local service's. */
export function SourceTag({ system }: { system: "knowledge" | "memory" }) {
  const s = useKnowledgeStrings().source;
  if (knowledgeMode === "local") {
    return (
      <span className="tag-chip tag-chip--notice" title={s.localTitle(system)}>
        {s.local(system)}
      </span>
    );
  }
  return (
    <span className="tag-chip tag-chip--demo" title={s.demoTitle(system)}>
      {s.demo(system)}
    </span>
  );
}

/**
 * The inspection panel beside a list or graph: a heading that takes focus when it opens
 * for a new subject, Escape and the close button to leave, and its parts settling in when
 * the subject changes (GSAP, reduced motion respected). As a `drawer` it holds a list the
 * graph is browsed from (the library, search results).
 */
export function SidePanel({
  title,
  subject,
  onClose,
  children,
  labelledBy,
  variant = "panel",
}: {
  title: ReactNode;
  /** Changes when the panel shows something else (motion and focus follow it). */
  subject: string;
  onClose: () => void;
  children: ReactNode;
  labelledBy: string;
  variant?: "panel" | "drawer";
}) {
  const s = useKnowledgeStrings();
  const ref = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEscapeLayer(true, onClose);
  useLayoutEffect(() => {
    // Opened from the page: focus follows. A fresh load leaves it on the page's h1.
    const from = document.activeElement as HTMLElement | null;
    if (from?.closest(".knowledge")) {
      if (!ref.current?.contains(from)) opener.current = from;
      heading.current?.focus({ preventScroll: false });
    }
    // The heading is there at once (a fade would hide it, and focus with it); the rest settles in.
    motion.arrive(ref.current ? Array.from(ref.current.children).slice(1) : []);
  }, [subject]);
  // Closed with focus inside: it goes to the panel that replaced this one, or back to what
  // opened it (a graph node, a list row), instead of falling to the page.
  useLayoutEffect(() => {
    const panel = ref.current;
    return () => {
      if (!panel?.contains(document.activeElement)) return;
      const back = opener.current;
      requestAnimationFrame(() => {
        if (document.activeElement && document.activeElement !== document.body) return;
        // The inspection that replaced it, or what opened it, or the list it was over.
        const next =
          document.querySelector<HTMLElement>(".kn-panel__head h3") ??
          (back?.isConnected ? back : null) ??
          document.querySelector<HTMLElement>(".kn-column__list:not([hidden]) .kn-drawer__head h3");
        next?.focus({ preventScroll: true });
      });
    };
  }, []);
  return (
    <aside ref={ref} className={`kn-${variant}`} aria-labelledby={labelledBy}>
      <div className={`kn-${variant}__head`}>
        <h3 ref={heading} id={labelledBy} tabIndex={-1}>
          {title}
        </h3>
        <button type="button" className="icon-button" aria-label={s.closePanel} title={s.closePanel} onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {children}
    </aside>
  );
}

/** An inline confirmation for a destructive action: what will happen, then the choice. */
export function Confirm({
  message,
  confirm,
  onConfirm,
  onCancel,
  busy,
}: {
  message: ReactNode;
  confirm: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const s = useKnowledgeStrings();
  const box = useRef<HTMLDivElement>(null);
  useEscapeLayer(true, onCancel);
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>("button[data-cancel]")?.focus();
  }, []);
  return (
    <div ref={box} className="kn-confirm" role="alertdialog" aria-modal="false" aria-label={confirm}>
      <div className="kn-confirm__text">{message}</div>
      <div className="kn-confirm__actions">
        <button type="button" className="button button--small kn-danger" onClick={onConfirm} disabled={busy}>
          {confirm}
        </button>
        <button type="button" className="button button--small" data-cancel onClick={onCancel} disabled={busy}>
          {s.cancel}
        </button>
      </div>
    </div>
  );
}

/** Equipment IDs follow the plant family's convention; show their names. */
const FAMILY: [RegExp, string][] = [
  [/^chiller_plant_(\d+)$/, "Chiller"],
  [/^cooling_towers_(\d+)$/, "Cooling tower"],
  [/^cooling_water_pump_(\d+)$/, "CW pump"],
  [/^chilled_water_pump_pri_(\d+)$/, "CHW pump"],
];
export function equipmentName(id: string) {
  for (const [re, label] of FAMILY) {
    const m = re.exec(id);
    if (m) return `${label} ${Number(m[1])}`;
  }
  return id === "terminal" ? "Data hall" : id;
}

/** ISO time as "2026-10-02 15:00 UTC" (memory and documents carry UTC). */
export function formatUtc(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
