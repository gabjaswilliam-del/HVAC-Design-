import { useState } from "react";
import { useNavigate } from "react-router";
import { ChevronDown, ChevronRight, CircleAlert, CircleCheck, Crosshair, Highlighter, LoaderCircle, PanelRight } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import type { AgentContext, DataView, NavTarget, Turn, TurnPart } from "../../lib/contracts/agent";
import type { SiteBundle } from "../../lib/contracts";
import { formatTime } from "../../lib/format";
import { TimeSeriesChart, type ChartSeries } from "../../components/TimeSeriesChart";
import { getOperating, operating } from "../../app/operatingContext";
import type { ScenarioId } from "../../fixtures/scenarios";

const ROLE_STYLE: Record<string, Pick<ChartSeries, "color" | "dashed" | "width">> = {
  observed: { color: "var(--chart-observed)" },
  forecast: { color: "var(--chart-forecast)", dashed: true },
  delivered: { color: "var(--chart-delivered)", width: 5 },
  capacity: { color: "var(--text-muted)", dashed: true },
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
    navigate(path);
  };
}

/** Plain text with "- " bullet lines; rendered as text, never as HTML. */
function Prose({ text }: { text: string }) {
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const list = line.startsWith("- ");
    const last = blocks.at(-1);
    if (last && last.list === list && list) last.lines.push(line.slice(2));
    else blocks.push({ list, lines: [list ? line.slice(2) : line] });
  }
  return (
    <>
      {blocks.map((b, i) =>
        b.list ? (
          <ul key={i} className="agent-prose__list">
            {b.lines.map((l, j) => (
              <li key={j}>{l}</li>
            ))}
          </ul>
        ) : (
          <p key={i} className="agent-prose__p">
            {b.lines[0]}
          </p>
        ),
      )}
    </>
  );
}

function ToolRow({ part }: { part: Extract<TurnPart, { type: "tool" }> }) {
  const s = useStrings();
  const a = s.agent;
  const [open, setOpen] = useState(false);
  const Icon = part.status === "running" ? LoaderCircle : part.status === "ok" ? CircleCheck : CircleAlert;
  const statusWord = part.status === "running" ? a.toolRunning : part.status === "ok" ? a.toolOk : a.toolError;
  return (
    <div className={`agent-tool agent-tool--${part.status}`} data-tool={part.tool} data-tool-status={part.status}>
      <button type="button" className="agent-tool__head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        <Icon size={14} aria-hidden="true" className={part.status === "running" ? "agent-tool__spin" : undefined} />
        <code className="agent-tool__name">{part.tool}</code>
        {part.simulated && <span className="agent-tool__badge">{a.simulatedTool}</span>}
        <span className="agent-tool__status">{statusWord}</span>
        <span className="visually-hidden">{open ? a.toolHideDetails : a.toolDetails}</span>
      </button>
      {part.summary && <p className="agent-tool__summary">{part.summary}</p>}
      {open && (
        <dl className="agent-tool__details">
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
    </div>
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
          <h4 className="agent-view__title">{view.title}</h4>
          <ul className="agent-view__equipment">
            {view.ids.map((id) => (
              <li key={id}>
                <span className="agent-view__name">{label(id)}</span>
                <button type="button" className="button button--small" onClick={() => go(`/equipment/${encodeURIComponent(id)}`)} aria-label={`${a.inspect} ${label(id)}`}>
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
          <h4 className="agent-view__title">{view.title}</h4>
          <ul className="agent-view__issues">
            {view.issues.map((i) => (
              <li key={i.id} className={`issue-line issue-line--${i.severity}`} data-issue={i.id}>
                <span className="issue-line__severity">
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

export function TurnView({ turn, site, context }: { turn: Turn; site: SiteBundle; context: AgentContext }) {
  const s = useStrings();
  const a = s.agent;
  return (
    <article className="agent-turn" data-turn-status={turn.status}>
      <div className="agent-turn__prompt">
        <span className="agent-turn__who">{a.you}</span>
        <p>{turn.prompt}</p>
      </div>
      <div className="agent-turn__answer">
        <span className="agent-turn__who">
          {a.assistant} <span className="agent-badge">{a.scripted}</span>
          <span className="agent-turn__time num">
            {formatTime(turn.at, site.site.timezone)} {site.site.timezoneLabel}
          </span>
        </span>
        {turn.parts.map((p, i) =>
          p.type === "text" ? (
            <div key={i} className="agent-prose">
              <Prose text={p.text} />
            </div>
          ) : p.type === "tool" ? (
            <ToolRow key={p.callId} part={p} />
          ) : (
            <ViewBlock key={i} view={p.view} site={site} context={context} />
          ),
        )}
        {turn.status === "running" && <LoaderCircle size={16} className="agent-tool__spin" aria-hidden="true" />}
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
