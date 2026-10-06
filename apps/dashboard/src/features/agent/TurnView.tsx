import { useId, useState } from "react";
import { useNavigate } from "react-router";
import { ChevronDown, ChevronRight, CircleAlert, CircleCheck, Crosshair, Highlighter, LoaderCircle, PanelRight } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import type { AgentContext, DataView, NavTarget, Turn, TurnPart } from "../../lib/contracts/agent";
import type { SiteBundle } from "../../lib/contracts";
import { formatTime } from "../../lib/format";
import { TimeSeriesChart, type ChartSeries } from "../../components/TimeSeriesChart";
import { getOperating, operating } from "../../app/operatingContext";
import type { ScenarioId } from "../../fixtures/scenarios";
import { isKpiKey } from "../monitoring/kpiDefinitions";
import { Prose } from "./Prose";

type ToolPart = Extract<TurnPart, { type: "tool" }>;

const ROLE_STYLE: Record<string, Pick<ChartSeries, "color" | "dashed" | "width">> = {
  observed: { color: "var(--chart-observed)" },
  forecast: { color: "var(--chart-forecast)", dashed: true },
  delivered: { color: "var(--chart-delivered)", width: 4 },
  capacity: { color: "var(--chart-capacity)", width: 1.5 },
};

export function targetPath(target: NavTarget) {
  switch (target.type) {
    case "monitoring_kpi":
      return `/?kpi=${encodeURIComponent(target.kpi)}`;
    case "equipment":
      return `/?equipment=${encodeURIComponent(target.id)}&locate=1`;
    case "prediction":
      return target.forecastId ? `/prediction?forecast=${encodeURIComponent(target.forecastId)}` : "/prediction";
    case "equipment_page":
      return target.id ? `/equipment/${encodeURIComponent(target.id)}` : "/equipment";
  }
}

/**
 * Navigation from an answer opens the dashboard in the conversation's own context:
 * the demo scenario and time it was recorded with, so linked views show the same data.
 */
function useContextNavigate(context: AgentContext) {
  const navigate = useNavigate();
  return (path: string, prepare?: () => void) => {
    const now = getOperating();
    const scenario = context.demoScenario?.id as ScenarioId | undefined;
    if (scenario && scenario !== now.scenarioId) operating.setScenario(scenario);
    if (Date.parse(context.at) !== now.cursor) operating.setCursor(Date.parse(context.at));
    operating.setPlaying(false);
    prepare?.();
    // Details opened from an answer wait as a strip, so the answer stays in view.
    const q = new URLSearchParams(path.split("?")[1] ?? "");
    const equipment = q.get("equipment");
    const kpi = q.get("kpi");
    if (equipment) operating.select(equipment);
    else if (isKpiKey(kpi)) operating.openKpi(kpi);
    if (equipment || isKpiKey(kpi)) operating.setDetailsCollapsed(true);
    navigate(path);
  };
}

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
  const go = useContextNavigate(context);
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
    case "chart": {
      const series: ChartSeries[] = view.series.map((x) => ({
        id: x.id,
        label: x.label,
        ...ROLE_STYLE[x.role],
        points: x.times.map((t, i) => ({ t: Date.parse(t), v: x.values[i] })),
      }));
      return (
        <section className="agent-view" data-view="chart">
          <TimeSeriesChart
            title={view.title}
            series={series}
            band={
              view.band && {
                label: view.band.label,
                color: "var(--chart-forecast)",
                points: view.band.times.map((t, i) => ({ t: Date.parse(t), lo: view.band!.lo[i], hi: view.band!.hi[i] })),
              }
            }
            unit={view.unit}
            decimals={view.decimals}
            timeZone={site.site.timezone}
            marker={view.cutoff ? { t: Date.parse(view.cutoff), label: s.forecast.dataThrough } : undefined}
            height={150}
          />
        </section>
      );
    }
    case "link":
      return (
        <p className="agent-view" data-view="link">
          <button type="button" className="text-button" onClick={() => go(targetPath(view.target))}>
            {view.label}
          </button>
        </p>
      );
  }
}

/**
 * One question and its answer as it arrives: the question at once, a working line until
 * the first step, the tool activity, then the answer streaming in; typed views follow.
 * New kinds of part (an assistant action, say) render here from their own typed payload.
 */
export function TurnView({ turn, site, context }: { turn: Turn; site: SiteBundle; context: AgentContext }) {
  const s = useStrings();
  const a = s.agent;
  const running = turn.status === "running";
  const groups = groupParts(turn.parts);
  const tail = turn.parts.at(-1);
  const working = running && (!tail || tail.type === "view" || (tail.type === "tool" && tail.status !== "running"));
  return (
    <article className="agent-turn" data-turn-status={turn.status} aria-busy={running || undefined}>
      <div className="agent-turn__prompt">
        <span className="agent-turn__who">{a.you}</span>
        <p>{turn.prompt}</p>
      </div>
      <div className="agent-turn__answer">
        <span className="agent-turn__who">
          {a.assistant} <span className="agent-badge">{a.scripted}</span>
          <span className="agent-turn__paced">{a.paced}</span>
          <span className="agent-turn__time num">
            {formatTime(turn.at, site.site.timezone)} {site.site.timezoneLabel}
          </span>
        </span>
        {groups.map((g, i) => {
          const last = i === groups.length - 1;
          if (g.type === "tools") return <ToolGroup key={i} tools={g.tools} startOpen={last && turn.status !== "complete"} />;
          if (g.type === "text") return <Prose key={i} text={g.text} streaming={running && last} />;
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
