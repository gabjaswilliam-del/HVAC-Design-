import { Fragment, useEffect, useId, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { X } from "lucide-react";
import { useStrings } from "../lib/i18n";
import { openIssues } from "../lib/issues";
import { useEscapeLayer } from "../components/escape";
import { ISSUES_KPI } from "../features/monitoring/kpiDefinitions";
import { navSearch, sections } from "./navigation";
import { getOperating, operating } from "./operatingContext";
import { useIssues } from "./site";
import { useShowOnPlant } from "./useShowOnPlant";

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || Boolean(t.closest("input, textarea, select, [role='slider']")));

/** Focus the assistant's composer, in the workspace or on the full page. */
const focusComposer = () =>
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".assistant-panel:not([hidden]) textarea, .agent-page textarea")?.focus());

/**
 * Single-key shortcuts. Never while typing or with a modifier, and never for an action
 * that changes anything outside this browser (acknowledging is always a button).
 */
export function useShortcuts(toggleList: () => void) {
  const location = useLocation();
  const navigate = useNavigate();
  const issues = useIssues();
  const showOnPlant = useShowOnPlant();
  const latest = useRef({ location, issues, showOnPlant, toggleList });
  latest.current = { location, issues, showOnPlant, toggleList };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const { location: loc, issues: iss, showOnPlant: show, toggleList: list } = latest.current;
      const overview = loc.pathname === "/";
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === "?") list();
      else if (["1", "2", "3", "4"].includes(k)) navigate({ pathname: sections[Number(k) - 1].path, search: navSearch(loc.search) });
      else if (k === ".") {
        const withEquipment = openIssues(iss.data?.issues).filter((i) => i.equipmentIds.length);
        if (!withEquipment.length) return operating.openKpi(ISSUES_KPI, true);
        const now = getOperating().selectedId;
        const i = withEquipment.findIndex((x) => x.equipmentIds.includes(now ?? ""));
        show(withEquipment[(i + 1) % withEquipment.length].equipmentIds[0]);
      } else if (k === "/") {
        e.preventDefault();
        if (loc.pathname !== "/agent") operating.openWorkspace("assistant");
        focusComposer();
      } else if (overview && k === "f") operating.requestFit();
      else if (overview && k === "l") operating.setOverviewView(getOperating().overviewView === "list" ? "schematic" : "list");
      else if (overview && k === "r") operating.cycleReadMode();
      else return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
}

/** The list of shortcuts, opened from the dock or with `?`. */
export function Shortcuts({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useStrings();
  const k = s.keys;
  const headingId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEscapeLayer(open, onClose);
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    dialog.current?.focus();
    return () => {
      const back = opener.current instanceof HTMLElement && opener.current.isConnected ? opener.current : document.querySelector<HTMLElement>("[data-shortcuts-opener]");
      back?.focus();
    };
  }, [open]);

  if (!open) return null;
  const rows: [string[][], string][] = [
    [[["1"], ["4"]], k.sections],
    [[["."]], k.next],
    [[["F"]], k.fit],
    [[["L"]], k.view],
    [[["R"]], k.readings],
    [[["/"]], k.ask],
    [[["Shift", "Enter"]], k.newLine],
    [[["Esc"]], k.escape],
    [[["?"]], k.list],
  ];
  return (
    <div ref={dialog} className="keys" role="dialog" aria-labelledby={headingId} tabIndex={-1}>
      <div className="keys__head">
        <h2 id={headingId}>{k.heading}</h2>
        <button type="button" className="icon-button" aria-label={k.close} title={k.close} onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <dl>
        {rows.map(([keys, what]) => (
          <Fragment key={what}>
            <dt>
              {keys.map((combo, i) => (
                <Fragment key={i}>
                  {i > 0 && ` ${k.to} `}
                  {combo.map((x, j) => (
                    <Fragment key={x}>
                      {j > 0 && "+"}
                      <kbd>{x}</kbd>
                    </Fragment>
                  ))}
                </Fragment>
              ))}
            </dt>
            <dd>{what}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}
