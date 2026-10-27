import { useId } from "react";
import { MessageSquare, Presentation, Trash2 } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { formatTime } from "../../lib/format";
import { displayItem, type DisplayContent, type DisplayItem } from "../../lib/contracts/display";
import { TimeSeriesChart, type ChartSeries } from "../../components/TimeSeriesChart";
import { BarChart } from "../../components/BarChart";
import { Notice } from "../../components/Notice";
import { operating } from "../../app/operatingContext";
import { display, useDisplay } from "./displayStore";
import "./display.css";

/** Series colours in order (validated chart tokens); dashed series are estimates. */
const COLORS = ["var(--chart-observed)", "var(--chart-delivered)", "var(--chart-capacity)", "var(--chart-neutral)"];

/** Loaded inside the frame before the page the model wrote: no network, no plugins. */
const SANDBOX_HEAD =
  '<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; font-src data:; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'">' +
  "<style>html{color-scheme:dark}body{margin:0;padding:12px;font:14px/1.5 system-ui,sans-serif;background:#1a1d21;color:#eceef0}</style>";

/**
 * The Overview's AI display: what the assistant retrieved, shown here instead of on another
 * screen (the `show_on_display` tool). The newest item is shown; earlier ones are one step
 * away. With nothing shown yet it says so. Everything it draws is data validated against
 * the display contract; a page the model wrote is shown sandboxed.
 */
export function AiDisplay({ timeZone }: { timeZone: string }) {
  const s = useStrings().display;
  const id = useId();
  const { items, shownId } = useDisplay();
  const item = items.find((x) => x.id === shownId) ?? null;

  if (!item) {
    return (
      <div className="ai-display ai-display--empty" data-ai-display="empty">
        <div className="ai-display__empty">
          <Presentation size={28} aria-hidden="true" />
          <h2>{s.emptyTitle}</h2>
          <p>{s.emptyBody}</p>
          <button type="button" className="button" onClick={() => operating.openWorkspace("assistant")}>
            <MessageSquare size={15} aria-hidden="true" />
            {s.ask}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ai-display" data-ai-display={item.id}>
      <header className="ai-display__head">
        <div className="ai-display__title">
          <h2 id={`${id}-title`}>{item.title}</h2>
          <span className="tag-chip tag-chip--notice">{s.fromAssistant}</span>
          {item.source.demo && (
            <span className="tag-chip tag-chip--demo" title={s.demoTitle}>
              {s.demo}
            </span>
          )}
          <span className="ai-display__time num">{s.shownAt(formatTime(item.shownAt, timeZone))}</span>
        </div>
        <div className="ai-display__controls">
          {items.length > 1 && (
            <label className="ai-display__earlier">
              <span>{s.earlier}</span>
              <select className="select" value={item.id} onChange={(e) => display.select(e.target.value)}>
                {[...items].reverse().map((x) => (
                  <option key={x.id} value={x.id}>
                    {`${formatTime(x.shownAt, timeZone)} ${x.title}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" className="button button--quiet" onClick={display.clear}>
            <Trash2 size={14} aria-hidden="true" />
            {s.clear}
          </button>
        </div>
      </header>
      {item.caption && <p className="ai-display__caption">{item.caption}</p>}
      <section className="ai-display__body" aria-labelledby={`${id}-title`}>
        {displayItem.safeParse(item).success ? <Content item={item} timeZone={timeZone} /> : <Notice tone="warning">{s.invalid}</Notice>}
      </section>
    </div>
  );
}

function Content({ item, timeZone }: { item: DisplayItem; timeZone: string }) {
  const s = useStrings().display;
  const c: DisplayContent = item.content;
  switch (c.kind) {
    case "line": {
      let n = 0;
      const series: ChartSeries[] = c.series.map((x, i) => ({
        id: `s${i}`,
        label: x.label,
        color: x.dashed ? "var(--chart-forecast)" : COLORS[n++ % COLORS.length],
        dashed: x.dashed,
        points: x.points.map((p) => ({ t: Date.parse(p.t), v: p.v })),
      }));
      return (
        <TimeSeriesChart
          title={item.title}
          series={series}
          band={c.band ? { label: c.band.label, color: "var(--chart-forecast)", points: c.band.points.map((p) => ({ t: Date.parse(p.t), lo: p.lo, hi: p.hi })) } : undefined}
          unit={c.unit}
          decimals={c.decimals ?? 1}
          timeZone={timeZone}
          height={360}
        />
      );
    }
    case "bar":
      return <BarChart title={item.title} bars={c.bars} unit={c.unit} decimals={c.decimals ?? 0} />;
    case "table":
      return (
        <div className="ai-display__table">
          <table className="data-table">
            <thead>
              <tr>
                {c.columns.map((col) => (
                  <th key={col.key} scope="col" className={col.align === "end" ? "is-end" : undefined}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {c.rows.map((row, i) => (
                <tr key={i}>
                  {c.columns.map((col) => (
                    <td key={col.key} className={col.align === "end" ? "is-end num" : undefined}>
                      {row[col.key] ?? "–"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "stats":
      return (
        <dl className="ai-display__stats">
          {c.items.map((x) => (
            <div key={x.label} className="ai-display__stat">
              <dt>{x.label}</dt>
              <dd className="num">{x.value}</dd>
              {x.note && <dd className="ai-display__note">{x.note}</dd>}
            </div>
          ))}
        </dl>
      );
    case "image":
      return <img className="ai-display__image" src={c.src} alt={c.alt} />;
    case "html":
      return (
        <>
          <iframe
            className="ai-display__frame"
            title={s.htmlTitle(item.title)}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            srcDoc={SANDBOX_HEAD + c.html}
            style={{ height: c.height ?? 480 }}
          />
          <p className="ai-display__note">{s.htmlNote}</p>
        </>
      );
  }
}
