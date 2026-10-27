import { useId, useState } from "react";
import { useNavigate } from "react-router";
import { ChevronDown, ChevronRight, CircleAlert, CircleCheck, Crosshair, FileText, Highlighter, LoaderCircle, PanelRight, PanelsTopLeft, Presentation, SquareMousePointer } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import type { AgentContext, DataView, Turn, TurnPart, WorkspaceAction } from "../../lib/contracts/agent";
import type { SiteBundle } from "../../lib/contracts";
import type { DisplayItem } from "../../lib/contracts/display";
import { formatTime } from "../../lib/format";
import { formatBytes } from "../../lib/agent/attachments";
import { NARROW, operating } from "../../app/operatingContext";
import { applyAction, openInContext, openTarget, showOnDisplay } from "../../app/openTarget";
import { targetPath } from "../../app/navigation";
import { wasApplied } from "./conversationSession";
import { Prose } from "./Prose";

type ToolPart = Extract<TurnPart, { type: "tool" }>;

/** Consecutive tool calls form one activity group; text and views stand alone. */
function groupParts(parts: TurnPart[]) {
  const out: ({ type: "tools"; tools: ToolPart[] } | Exclude<TurnPart, ToolPart>)[] = [];
  for (const p of parts) {
    const last = out.at(-1);
    if (p.type !== "tool") out.push(p);
    else if (last?.type === "tools") last.tools.push(p);
    else out.push({ type: "tools", tools: [p] });
  }
  return out;
}

/**
 * A run of tool calls: open while it is the latest activity, folded to one line once the
 * answer begins, open again on request. Simulated tools are named as such in its head.
 */
function ToolGroup({ tools, startOpen }: { tools: ToolPart[]; startOpen: boolean }) {
  const a = useStrings().agent;
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? startOpen;
  const listId = useId();
  const simulated = tools.every((t) => t.simulated);
  const failed = tools.filter((t) => t.status === "error").length;
  return (
    <div className="agent-activity">
      <button type="button" className="agent-activity__head" aria-expanded={open} aria-controls={listId} onClick={() => setChoice(!open)}>
        {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        {simulated && <span className="agent-activity__mark" aria-hidden="true" />}
        <span>{tools.some((t) => t.status === "running") ? a.usingTools(simulated) : a.usedTools(tools.length, simulated)}</span>
        {failed > 0 && <span className="agent-activity__failed">{a.toolsFailed(failed)}</span>}
      </button>
      <ul id={listId} className="agent-activity__list" hidden={!open}>
        {tools.map((t) => (
          <ToolRow key={t.callId} part={t} />
        ))}
      </ul>
    </div>
  );
}

/** One step: what it is doing, then Complete or Failed with the tool's own summary; the
 *  tool name and arguments open beneath. */
function ToolRow({ part }: { part: ToolPart }) {
  const a = useStrings().agent;
  const [open, setOpen] = useState(false);
  const running = part.status === "running";
  const [doing, done] = a.toolSteps[part.tool] ?? a.toolStep(part.tool);
  const Icon = running ? LoaderCircle : part.status === "ok" ? CircleCheck : CircleAlert;
  const statusWord = running ? a.toolRunning : part.status === "ok" ? a.toolOk : a.toolError;
  return (
    <li className={`agent-tool agent-tool--${part.status}`} data-tool={part.tool} data-tool-status={part.status}>
      <button type="button" className="agent-tool__head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon size={14} aria-hidden="true" className={running ? "agent-tool__icon agent-tool__spin" : "agent-tool__icon"} />
        <span className="agent-tool__label">{running ? doing : done}</span>
        <span className={running ? "visually-hidden" : "agent-tool__status"}>{statusWord}</span>
        {open ? <ChevronDown size={13} aria-hidden="true" className="agent-tool__more" /> : <ChevronRight size={13} aria-hidden="true" className="agent-tool__more" />}
        <span className="visually-hidden">{open ? a.toolHideDetails : a.toolDetails}</span>
      </button>
      {part.summary && <p className="agent-tool__summary">{part.summary}</p>}
      {open && (
        <dl className="agent-tool__details">
          <dt>{a.toolName}</dt>
          <dd>
            <code>{part.tool}</code>
            {part.simulated && `, ${a.simulatedTool.toLowerCase()}`}
          </dd>
          <dt>{a.arguments}</dt>
          <dd>
            {Object.entries(part.args).map(([k, v]) => (
              <div key={k}>
                <span className="agent-tool__arg">{k}</span> {String(v)}
              </div>
            ))}
          </dd>
          <dt>{a.result}</dt>
          <dd>{part.summary ?? statusWord}</dd>
        </dl>
      )}
    </li>
  );
}

/** Between steps: a quiet working line, never a narration of reasoning. */
function Working() {
  const a = useStrings().agent;
  return (
    <p className="agent-working">
      <span className="agent-working__meter" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {a.working}
    </p>
  );
}

function ViewBlock({ view, site, context }: { view: DataView; site: SiteBundle; context: AgentContext }) {
  const s = useStrings();
  const a = s.agent;
  const navigate = useNavigate();
  const go = (path: string, prepare?: () => void) => openInContext(navigate, context, path, prepare);
  const label = (id: string) => site.topology.devices.find((d) => d.id === id)?.label ?? id;

  switch (view.kind) {
    case "equipment":
      return (
        <section className="agent-view" data-view="equipment">
          <h3 className="agent-view__title">{view.title}</h3>
          <ul className="agent-view__equipment">
            {view.ids.map((id) => (
              <li key={id}>
                <span className="agent-view__name">{label(id)}</span>
                <button type="button" className="button button--small" onClick={() => go(`/?equipment=${encodeURIComponent(id)}`)} aria-label={`${a.inspect} ${label(id)}`}>
                  <PanelRight size={14} aria-hidden="true" />
                  {a.inspect}
                </button>
                <button type="button" className="button button--small" onClick={() => go(targetPath({ type: "equipment", id }))} aria-label={`${a.locate} ${label(id)}`}>
                  <Crosshair size={14} aria-hidden="true" />
                  {a.locate}
                </button>
              </li>
            ))}
          </ul>
          {view.ids.length > 1 && (
            <button type="button" className="button button--small" onClick={() => go("/", () => operating.highlight(view.ids))}>
              <Highlighter size={14} aria-hidden="true" />
              {a.showOnPlant}
            </button>
          )}
        </section>
      );
    case "issues":
      return (
        <section className="agent-view" data-view="issues">
          <h3 className="agent-view__title">{view.title}</h3>
          <ul className="agent-view__issues">
            {view.issues.map((i) => (
              <li key={i.id} className="issue-line" data-issue={i.id}>
                <span className={`sev sev--${i.severity}`}>
                  {s.issues.severity[i.severity]}, {i.id}
                </span>
                <span className="issue-line__title">{i.title}</span>
                <span className="agent-view__issue-actions">
                  {i.equipmentIds.map((id) => (
                    <button key={id} type="button" className="text-button" onClick={() => go(targetPath({ type: "equipment", id }))}>
                      {label(id)}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <button type="button" className="text-button" onClick={() => go(targetPath({ type: "monitoring_kpi", kpi: "issues" }))}>
            {a.issueDetails}
          </button>
        </section>
      );
    case "link":
      return (
        <p className="agent-view" data-view="link">
          <button type="button" className="text-button" onClick={() => openTarget(navigate, context, view.target)}>
            {view.label}
          </button>
        </p>
      );
  }
}

/**
 * What the assistant did in the workspace (or asked to: a turn stopped or shown elsewhere
 * did not), with a way back to it: a view it opened, or an operator control it pointed to
 * in AI Pilot (which only the operator presses). On a phone, where the conversation covers
 * the screen, reopening a view closes the sheet to show it.
 */
function ActionLine({ turnId, action, context }: { turnId: string; action: WorkspaceAction; context: AgentContext }) {
  const a = useStrings().agent;
  const navigate = useNavigate();
  const applied = wasApplied(turnId, action);
  const reveal = action.kind === "reveal";
  const again = reveal ? (applied ? a.showAgain : a.showControl) : applied ? a.openAgain : a.openView;
  const Icon = reveal ? SquareMousePointer : PanelsTopLeft;
  return (
    <p className="agent-action" data-view="action" data-action={action.kind} data-applied={applied || undefined}>
      <Icon size={14} aria-hidden="true" className="agent-action__icon" />
      <span className="agent-action__text">
        {reveal ? (applied ? a.actionPointed : a.actionControl) : applied ? a.actionOpened : a.actionView} <span className="agent-action__label">{action.label}</span>
      </span>
      <button
        type="button"
        className="text-button agent-action__open"
        onClick={() => {
          if (reveal) return applyAction(navigate, context, action);
          openTarget(navigate, context, action.target);
          if (action.target.type !== "pilot" && matchMedia(NARROW).matches) operating.closeWorkspace();
        }}
        aria-label={`${again}: ${action.label}`}
      >
        {again}
      </button>
    </p>
  );
}

/** What the assistant put on the AI display, with a way back to it. */
function DisplayLine({ item }: { item: DisplayItem }) {
  const d = useStrings().display;
  const navigate = useNavigate();
  return (
    <p className="agent-action" data-view="display" data-display-id={item.id}>
      <Presentation size={14} aria-hidden="true" className="agent-action__icon" />
      <span className="agent-action__text">{d.shown(item.title)}</span>
      <button
        type="button"
        className="text-button agent-action__open"
        aria-label={`${d.showAgain}: ${item.title}`}
        onClick={() => {
          showOnDisplay(navigate, item);
          // On a phone the conversation covers the screen: close it to show the display.
          if (matchMedia(NARROW).matches) operating.closeWorkspace();
        }}
      >
        {d.showAgain}
      </button>
    </p>
  );
}

/**
 * One question and its answer as it arrives: the question at once, a working line until
 * the first step, the tool activity, then the answer streaming in; typed views and the
 * views the assistant opened follow, each rendered from its own typed payload.
 */
export function TurnView({ turn, site, context }: { turn: Turn; site: SiteBundle; context: AgentContext }) {
  const s = useStrings();
  const a = s.agent;
  const running = turn.status === "running";
  const groups = groupParts(turn.parts);
  const tail = turn.parts.at(-1);
  const working = running && (!tail || tail.type === "view" || tail.type === "action" || tail.type === "display" || (tail.type === "tool" && tail.status !== "running"));
  return (
    <article className="agent-turn" data-turn-status={turn.status} aria-busy={running || undefined}>
      <div className="agent-turn__prompt">
        <span className="agent-turn__who">{a.you}</span>
        {turn.prompt && <p>{turn.prompt}</p>}
        {turn.attachments?.length ? (
          <ul className="agent-files" aria-label={a.attachedFiles}>
            {turn.attachments.map((f) => (
              <li key={f.name} className="agent-file">
                <FileText size={13} aria-hidden="true" />
                <span className="agent-file__name" title={f.name}>{f.name}</span>
                <span className="agent-file__size num">{formatBytes(f.size)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="agent-turn__answer">
        <span className="agent-turn__who">
          {a.assistant} <span className="agent-badge" title={a.offlineTitle}>{a.offline}</span>
          <span className="agent-turn__paced">{a.paced}</span>
          <span className="agent-turn__time num">
            {formatTime(turn.at, site.site.timezone)} {site.site.timezoneLabel}
          </span>
        </span>
        {groups.map((g, i) => {
          const last = i === groups.length - 1;
          if (g.type === "tools") return <ToolGroup key={i} tools={g.tools} startOpen={last && turn.status !== "complete"} />;
          if (g.type === "text") return <Prose key={i} text={g.text} streaming={running && last} />;
          if (g.type === "action") return <ActionLine key={i} turnId={turn.id} action={g.action} context={context} />;
          if (g.type === "display") return <DisplayLine key={i} item={g.item} />;
          return <ViewBlock key={i} view={g.view} site={site} context={context} />;
        })}
        {working && <Working />}
        {turn.status === "cancelled" && <p className="agent-turn__note">{a.cancelled}</p>}
        {turn.status === "error" && (
          <p className="agent-turn__note agent-turn__note--error">
            {a.failed} {turn.error?.message}
          </p>
        )}
      </div>
    </article>
  );
}
