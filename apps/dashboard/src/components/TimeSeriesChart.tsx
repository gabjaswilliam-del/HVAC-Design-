import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStrings } from "../lib/i18n";
import { formatNumber, formatTime, tzOffsetMs } from "../lib/format";

export interface ChartSeries {
  id: string;
  label: string;
  /** Validated chart colour (see styles/tokens.css --chart-*). */
  color: string;
  dashed?: boolean;
  /** Line width; a wider line drawn first stays visible under a coinciding one. */
  width?: number;
  points: { t: number; v: number | null }[];
}

export interface ChartBand {
  label: string;
  color: string;
  points: { t: number; lo: number | null; hi: number | null }[];
}

interface TimeSeriesChartProps {
  /** Accessible name; also the chart's caption when there is one series. */
  title: string;
  series: ChartSeries[];
  band?: ChartBand;
  unit: string;
  decimals: number;
  timeZone: string;
  xDomain?: [number, number];
  marker?: { t: number; label: string };
  height?: number;
}

const M = { l: 46, r: 12, t: 22, b: 22 };
const HOUR = 3_600_000;

function niceStep(span: number, target: number) {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw) ?? raw;
}

function segments(points: { x: number; y: number | null }[]) {
  let d = "";
  let pen = false;
  for (const p of points) {
    if (p.y === null) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    pen = true;
  }
  return d;
}

/**
 * Time-series line chart: thin lines, gaps for missing values (never interpolated),
 * observed/forecast distinguished by dash and label, an interval band only when one is
 * supplied, a crosshair tooltip, and a table view with the same numbers.
 */
export function TimeSeriesChart({ title, series, band, unit, decimals, timeZone, xDomain, marker, height = 160 }: TimeSeriesChartProps) {
  const s = useStrings();
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  useLayoutEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const times = useMemo(() => {
    const all = new Set<number>();
    series.forEach((x) => x.points.forEach((p) => all.add(p.t)));
    band?.points.forEach((p) => all.add(p.t));
    return [...all].sort((a, b) => a - b);
  }, [series, band]);

  const values = [
    ...series.flatMap((x) => x.points.map((p) => p.v)),
    ...(band?.points.flatMap((p) => [p.lo, p.hi]) ?? []),
  ].filter((v): v is number => v !== null);
  const empty = values.length === 0;

  const [t0, t1] = xDomain ?? [times[0] ?? 0, times.at(-1) ?? 1];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (empty) (lo = 0), (hi = 1);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.08;
  const yStep = niceStep(hi - lo + 2 * pad, 4);
  // Never invent negative axis room for data that is all zero or positive.
  const y0 = lo >= 0 ? Math.max(0, Math.floor((lo - pad) / yStep) * yStep) : Math.floor((lo - pad) / yStep) * yStep;
  const y1 = Math.ceil((hi + pad) / yStep) * yStep;

  const pw = Math.max(1, width - M.l - M.r);
  const ph = height - M.t - M.b;
  const x = (t: number) => M.l + ((t - t0) / (t1 - t0 || 1)) * pw;
  const y = (v: number) => M.t + (1 - (v - y0) / (y1 - y0)) * ph;

  const yTicks: number[] = [];
  for (let v = y0; v <= y1 + yStep / 2; v += yStep) yTicks.push(v);
  const spanH = (t1 - t0) / HOUR;
  const xStepH = [1, 2, 3, 4, 6, 12, 24].find((h) => spanH / h <= Math.max(3, Math.floor(pw / 90))) ?? 24;
  const offset = tzOffsetMs(timeZone, t0);
  const xTicks: number[] = [];
  for (let t = Math.ceil((t0 + offset) / (xStepH * HOUR)) * xStepH * HOUR - offset; t <= t1; t += xStepH * HOUR) xTicks.push(t);

  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? s.quality.unavailable : formatNumber(v, decimals));
  const at = <P extends { t: number }>(pts: P[], t: number) => pts.find((p) => p.t === t);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!times.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const t = t0 + ((e.clientX - rect.left - M.l) / pw) * (t1 - t0);
    let best = times[0];
    for (const c of times) if (Math.abs(c - t) < Math.abs(best - t)) best = c;
    setHoverT(best);
  };

  const legend = series.length > 1 || band;
  const bandPath = band
    ? band.points
        .reduce<{ t: number; lo: number; hi: number }[][]>((runs, p) => {
          if (p.lo === null || p.hi === null) runs.push([]);
          else runs[runs.length - 1].push({ t: p.t, lo: p.lo, hi: p.hi });
          return runs;
        }, [[]])
        .filter((r) => r.length > 1)
        .map((r) => `M${r.map((p) => `${x(p.t)} ${y(p.hi)}`).join("L")}L${[...r].reverse().map((p) => `${x(p.t)} ${y(p.lo)}`).join("L")}Z`)
        .join("")
    : "";

  return (
    <figure className="ts-chart">
      {legend && (
        <ul className="ts-chart__legend">
          {series.map((x) => (
            <li key={x.id}>
              <svg width="22" height="8" aria-hidden="true">
                <line x1="1" y1="4" x2="21" y2="4" stroke={x.color} strokeWidth="2" strokeDasharray={x.dashed ? "5 3" : undefined} />
              </svg>
              {x.label}
            </li>
          ))}
          {band && (
            <li>
              <span className="ts-chart__swatch" style={{ background: band.color }} />
              {band.label}
            </li>
          )}
        </ul>
      )}
      <div ref={wrap} className="ts-chart__plot">
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`${title} (${unit})`}
            onPointerMove={onMove}
            onPointerLeave={() => setHoverT(null)}
          >
            {yTicks.map((v) => (
              <g key={v}>
                <line x1={M.l} x2={width - M.r} y1={y(v)} y2={y(v)} className="ts-chart__grid" />
                <text x={M.l - 6} y={y(v) + 4} textAnchor="end" className="ts-chart__tick">
                  {formatNumber(v, yStep < 1 ? 1 : 0)}
                </text>
              </g>
            ))}
            {xTicks.map((t) => (
              <text key={t} x={x(t)} y={height - 6} textAnchor="middle" className="ts-chart__tick">
                {formatTime(t, timeZone)}
              </text>
            ))}
            <text x={4} y={12} className="ts-chart__unit">
              {unit}
            </text>
            {band && <path d={bandPath} fill={band.color} opacity={0.22} />}
            {marker && (
              <g>
                <line x1={x(marker.t)} x2={x(marker.t)} y1={M.t} y2={M.t + ph} className="ts-chart__marker" />
                <text x={x(marker.t) + 4} y={M.t + 10} className="ts-chart__tick">
                  {marker.label}
                </text>
              </g>
            )}
            {series.map((x0) => (
              <path
                key={x0.id}
                d={segments(x0.points.map((p) => ({ x: x(p.t), y: p.v === null ? null : y(p.v) })))}
                fill="none"
                stroke={x0.color}
                strokeWidth={x0.width ?? 2}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={x0.dashed ? "6 4" : undefined}
              />
            ))}
            {empty && (
              <text x={M.l + pw / 2} y={M.t + ph / 2} textAnchor="middle" className="ts-chart__tick">
                {s.chart.noData}
              </text>
            )}
            {hoverT !== null && (
              <g pointerEvents="none">
                <line x1={x(hoverT)} x2={x(hoverT)} y1={M.t} y2={M.t + ph} className="ts-chart__crosshair" />
                {series.map((x0) => {
                  const p = at(x0.points, hoverT);
                  return p && p.v !== null ? (
                    <circle key={x0.id} cx={x(hoverT)} cy={y(p.v)} r={4} fill={x0.color} stroke="var(--panel)" strokeWidth={2} />
                  ) : null;
                })}
              </g>
            )}
          </svg>
        )}
        {hoverT !== null && (
          <div
            className="ts-chart__tooltip"
            style={{ left: Math.min(Math.max(x(hoverT) + 10, 0), Math.max(0, width - 190)) }}
            role="presentation"
          >
            <div className="ts-chart__tooltip-time">{formatTime(hoverT, timeZone)}</div>
            {series.map((x0) => {
              const p = at(x0.points, hoverT);
              return p ? (
                <div key={x0.id} className="ts-chart__tooltip-row">
                  <span className="ts-chart__swatch" style={{ background: x0.color }} />
                  {x0.label}
                  <strong className="num">
                    {fmt(p.v)} {p.v !== null ? unit : ""}
                  </strong>
                </div>
              ) : null;
            })}
            {band &&
              (() => {
                const p = at(band.points, hoverT);
                return p && p.lo !== null ? (
                  <div className="ts-chart__tooltip-row ts-chart__tooltip-muted">
                    {band.label}
                    <span className="num">
                      {fmt(p.lo)} – {fmt(p.hi)}
                    </span>
                  </div>
                ) : null;
              })()}
          </div>
        )}
      </div>
      <button
        type="button"
        className="text-button"
        aria-expanded={showTable}
        aria-controls={tableId}
        onClick={() => setShowTable((v) => !v)}
      >
        {showTable ? s.chart.hideTable : s.chart.showTable}
      </button>
      {showTable && (
        <div className="ts-chart__table" id={tableId}>
          <table>
            <caption className="visually-hidden">{title}</caption>
            <thead>
              <tr>
                <th scope="col">{s.chart.time}</th>
                {series.map((x0) => (
                  <th key={x0.id} scope="col">
                    {x0.label} ({unit})
                  </th>
                ))}
                {band && (
                  <>
                    <th scope="col">
                      {band.label} {s.chart.lower}
                    </th>
                    <th scope="col">
                      {band.label} {s.chart.upper}
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {times.map((t) => (
                <tr key={t}>
                  <th scope="row">{formatTime(t, timeZone)}</th>
                  {series.map((x0) => {
                    const p = at(x0.points, t);
                    return (
                      <td key={x0.id} className="num">
                        {p ? fmt(p.v) : ""}
                      </td>
                    );
                  })}
                  {band &&
                    (() => {
                      const p = at(band.points, t);
                      return (
                        <>
                          <td className="num">{p ? fmt(p.lo) : ""}</td>
                          <td className="num">{p ? fmt(p.hi) : ""}</td>
                        </>
                      );
                    })()}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}
