import { useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Link } from "react-router";
import { Bot, Maximize2, MessageSquareText, PanelRight, PanelRightClose, type LucideIcon } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { useRestoreFocus } from "../../components/useRestoreFocus";
import { AssistantPanel } from "../../features/agent";
import { PilotConsole } from "../../features/pilot";
import { clampWidth, getOperating, operating, useOperating, WORKSPACE_DEFAULT, WORKSPACE_MAX, WORKSPACE_MIN, type WorkspaceTab } from "../operatingContext";
import type { WorkspaceLayout } from "../useWorkspaceLayout";
import { DetailsPane, DetailsStrip } from "./DetailsPane";
import "./workspace.css";


const TABS: { tab: WorkspaceTab; icon: LucideIcon }[] = [
  { tab: "assistant", icon: MessageSquareText },
  { tab: "pilot", icon: Bot },
];

/**
 * The permanent right-hand workspace: Details for what is selected lead, above the
 * Assistant and the Pilot; typing to the assistant folds Details to a strip. Rendered
 * once by the shell, so it keeps its state across every screen.
 */
export function Workspace({ layout }: { layout: WorkspaceLayout }) {
  const s = useStrings();
  const w = s.workspace;
  const { tab, width, open } = useOperating((x) => x.workspace);
  const hasDetails = useOperating((x) => Boolean(x.selectedId || x.kpiKey));
  const collapsed = useOperating((x) => x.detailsCollapsed);
  const conversationId = useOperating((x) => x.assistant.conversationId);
  // Here rather than in Details: focus returns after Details have closed.
  const restoreFocus = useRestoreFocus();
  const tabs = useRef<HTMLDivElement>(null);

  // The selected tab's raised pill slides between the tabs.
  useLayoutEffect(() => {
    const list = tabs.current;
    const sel = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !sel) return;
    list.style.setProperty("--pill-x", `${sel.offsetLeft}px`);
    list.style.setProperty("--pill-w", `${sel.offsetWidth}px`);
  });

  if (layout === "hidden") return null;

  const float = layout === "float";
  const dock = (layout === "collapsed" || float) && (
    <div className="ws-dock" role="toolbar" aria-orientation="vertical" aria-label={w.label}>
      {TABS.map(({ tab: t, icon }) => (
        <DockButton
          key={t}
          icon={icon}
          label={w[t]}
          title={t === "assistant" ? w.openAssistant : w.openPilot}
          pressed={float && open && tab === t}
          // The same button again dismisses the floating panel.
          onClick={() => (float && tab === t ? operating.closeWorkspace() : operating.openWorkspace(t))}
        />
      ))}
      {hasDetails && !open && <DockButton icon={PanelRight} label={w.details} title={w.showDetails} pressed={false} onClick={() => operating.openWorkspace()} />}
    </div>
  );
  if (layout === "collapsed") return dock;

  const showTab = (t: WorkspaceTab) => {
    operating.setWorkspaceTab(t);
    // Choosing a tab while Details lead hands the space to it.
    if (hasDetails) operating.setDetailsCollapsed(true);
  };
  const onTabKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = tab === "assistant" ? "pilot" : "assistant";
    showTab(next);
    document.getElementById(`ws-tab-${next}`)?.focus();
  };
  const detailsLead = hasDetails && !collapsed;

  return (
    <>
      {dock}
      <aside
        className={`workspace workspace--${layout}`}
        aria-label={w.label}
        data-details={hasDetails ? (detailsLead ? "lead" : "strip") : undefined}
      >
        {layout === "docked" && <Resizer width={width} />}
        {detailsLead && (
          <div className="workspace__details">
            <DetailsPane restoreFocus={restoreFocus} />
          </div>
        )}
        {hasDetails && collapsed && <DetailsStrip />}
        <div className="workspace__ai" hidden={layout === "sheet" && detailsLead}>
          <div className="workspace__bar">
            <div ref={tabs} className="workspace__tabs" role="tablist" aria-label={w.modes} onKeyDown={onTabKey}>
              <span className="workspace__pill" aria-hidden="true" />
              {TABS.map(({ tab: t, icon: Icon }) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  id={`ws-tab-${t}`}
                  className="workspace__tab"
                  aria-selected={tab === t}
                  aria-controls={`${t}-panel`}
                  tabIndex={tab === t ? 0 : -1}
                  onClick={() => showTab(t)}
                >
                  <Icon size={15} aria-hidden="true" />
                  {w[t]}
                </button>
              ))}
            </div>
            <div className="workspace__actions">
              {/* The assistant expands to its full page; AI Pilot lives here only. */}
              {tab === "assistant" && (
                <Link
                  className="icon-button"
                  to={conversationId ? `/agent?conversation=${encodeURIComponent(conversationId)}` : "/agent"}
                  aria-label={s.agent.openPage}
                  title={s.agent.openPage}
                >
                  <Maximize2 size={15} aria-hidden="true" />
                </Link>
              )}
              <button type="button" className="icon-button" aria-label={w.collapse} title={w.collapse} onClick={() => operating.closeWorkspace()}>
                <PanelRightClose size={17} aria-hidden="true" />
              </button>
            </div>
          </div>
          <AssistantPanel hidden={tab !== "assistant"} />
          <PilotConsole hidden={tab !== "pilot"} />
        </div>
      </aside>
    </>
  );
}

function DockButton({ icon: Icon, label, title, pressed, onClick }: { icon: LucideIcon; label: string; title: string; pressed: boolean; onClick: () => void }) {
  return (
    <button type="button" className="ws-dock__button" title={title} aria-pressed={pressed} onClick={onClick}>
      <Icon size={18} aria-hidden="true" />
      <span className="ws-dock__label">{label}</span>
    </button>
  );
}

/** Drag or use the arrow keys to resize; double-click restores the default width. */
function Resizer({ width }: { width: number }) {
  const s = useStrings();
  const max = clampWidth(WORKSPACE_MAX);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    el.classList.add("is-active");
    let frame = 0;
    const move = (ev: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => operating.setWorkspaceWidth(window.innerWidth - ev.clientX));
    };
    const up = () => {
      cancelAnimationFrame(frame);
      el.classList.remove("is-active");
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      operating.setWorkspaceWidth(getOperating().workspace.width, true);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // The workspace is on the right: moving its edge left makes it wider.
    const next = { ArrowLeft: width + 16, ArrowRight: width - 16, Home: max, End: WORKSPACE_MIN }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    operating.setWorkspaceWidth(next, true);
  };

  return (
    <div
      className="workspace__resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={s.workspace.resize}
      aria-valuemin={WORKSPACE_MIN}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => operating.setWorkspaceWidth(WORKSPACE_DEFAULT, true)}
    />
  );
}
