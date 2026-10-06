import type { ReactNode } from "react";
import { useStrings } from "../../../lib/i18n";
import { formatNumber } from "../../../lib/format";
import type { Issue, MetricInfo, Topology } from "../../../lib/contracts";
import { spriteGeometry, type SpriteKind } from "./geometry";
import type { View } from "./panZoom";
import type { SceneLayout, SceneReadings } from "./types";

/** The one reading Key mode shows per item (F5): tower and pump Hz, chiller and data hall kWt. */
const PRIMARY: Record<SpriteKind, string> = {
  coolingTower: "frequency_hz",
  pump: "frequency_hz",
  chiller: "cooling_kw",
  dataHall: "cooling_demand_kw",
};
/** Readings shown inside the name label rather than beside the sprite. */
const INLINE: SpriteKind[] = ["chiller", "dataHall"];
/** Overlay items under a floating panel are not drawn (their tags move to its edge). */
const EDGE = 8;

const at = (v: View, x: number, y: number) => [v.x + x * v.k, v.y + y * v.k];

// Name widths at the label size, to fit crowded rows. Measured once per text.
const NAME_FONT = '600 12px "Barlow Semi Condensed", sans-serif';
const widths = new Map<string, number>();
let measurer: CanvasRenderingContext2D | null | undefined;
function nameWidth(text: string) {
  if (!widths.has(text)) {
    measurer ??= typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
    if (!measurer) return 0;
    measurer.font = NAME_FONT;
    widths.set(text, measurer.measureText(text).width);
  }
  return widths.get(text)!;
}

interface Common {
  topology: Topology;
  layout: SceneLayout;
  view: View;
  /** Screen x beyond which a floating panel covers the drawing. */
  limit: number;
}

/**
 * Key mode (below 80% zoom): names at one legible size in screen space, state words
 * only for Fault and Stopped, and one primary reading per item in a plate. With
 * `values` off (readings Off), names only.
 */
export function KeyLayer({ topology, layout, view, limit, readings, metrics, values }: Common & { readings: SceneReadings; metrics: MetricInfo[]; values: boolean }) {
  const s = useStrings();
  const out: ReactNode[] = [];

  const plate = (metric: string, cls: string) => {
    const m = metrics.find((x) => x.key === metric);
    const r = readings.values[metric];
    const stale = cls === "stale" || r?.quality === "stale";
    if (!r || r.value === null) return { text: <span className="key__missing">{s.scene.valueUnavailable}</span>, cls: "missing" };
    return {
      text: (
        <>
          {formatNumber(r.value, m?.decimals ?? 1)}
          {m?.unit && <span className="unit">{m.unit}</span>}
        </>
      ),
      cls: stale ? "stale" : cls,
    };
  };

  // Where each name sits (screen space). In a crowded row (a small window at 200% text
  // zoom, say) a name shrinks to fit, down to 10 px, and its state word drops below it.
  const nameAt = (n: SceneLayout["nodes"][string]) => {
    const g = spriteGeometry[n.kind];
    if (n.labelAt === "right") return at(view, n.x + g.width / 2 + 10, n.y + g.height + 23);
    if (n.labelAt === "above") return at(view, n.x + g.width / 2, n.y - 30);
    return at(view, n.x + g.width / 2, n.y + g.height + 4);
  };
  const stateWord = (id: string) => {
    const st = readings.equipment[id];
    return !st?.stale && (st?.state === "fault" || st?.state === "stopped") ? s.scene.states[st.state] : null;
  };
  // A label's natural width: name, padding, and the state word beside it.
  const natural = (id: string, label: string) => {
    const word = stateWord(id);
    return nameWidth(label) + 8 + (word ? 5 + (nameWidth(word) * 11.5) / 12 : 0);
  };
  const spots = topology.devices.flatMap((d) =>
    layout.nodes[d.id] ? [{ id: d.id, xy: nameAt(layout.nodes[d.id]), width: natural(d.id, d.label) }] : [],
  );
  // Room on a crowded row: a name may take what a narrower neighbour leaves, or a fair
  // half of the gap, whichever is more. Either way neighbours never overlap.
  const room = (id: string, [x, y]: number[]) => {
    const near = spots
      .filter((o) => o.id !== id && Math.abs(o.xy[1] - y) < 14)
      .map((o) => {
        const d = Math.abs(o.xy[0] - x);
        return Math.max(d - 6, 2 * (d - o.width / 2) - 4);
      });
    return near.length ? Math.max(40, Math.min(...near)) : undefined;
  };

  for (const d of topology.devices) {
    const node = layout.nodes[d.id];
    if (!node) continue;
    const g = spriteGeometry[node.kind];
    const status = readings.equipment[d.id];
    const state = status?.state ?? "unavailable";
    const cls = status?.stale ? "stale" : state === "fault" ? "fault" : state === "stopped" ? "stopped" : "";
    // Stale data shows through the caution ring and the top bar, not a state word.
    const word = stateWord(d.id);
    const inline = INLINE.includes(node.kind);
    const value = values ? plate(`${d.id}:${PRIMARY[node.kind]}`, cls) : null;

    const right = node.labelAt === "right";
    const [nx, ny] = nameAt(node);
    if (nx <= limit - EDGE) {
      const space = room(d.id, [nx, ny]);
      // The label's 8 px padding does not scale; 2 px spare for rounding.
      const text = space ? space - 10 : 0;
      const fit = space && nameWidth(d.label) > text ? Math.max(10, (12 * text) / nameWidth(d.label)) : undefined;
      out.push(
        <span
          key={`n-${d.id}`}
          data-for={d.id}
          className={`lbl${right ? " lbl--mid" : ""}${word ? ` lbl--${state}` : ""}`}
          style={{ left: nx, top: ny, maxWidth: space, fontSize: fit }}
        >
          <span className="lbl__name">{d.label}</span>
          {word && <span className="lbl__state">{word}</span>}
          {inline && value && <span className={`lbl__val${value.cls ? ` lbl__val--${value.cls}` : ""}`}>{value.text}</span>}
        </span>,
      );
    }
    if (value && !inline) {
      const [kx, ky] = node.kind === "coolingTower" ? at(view, node.x + g.width + 5, node.y + 26) : at(view, node.x + g.width + 8, node.y + 13);
      if (kx <= limit - EDGE) {
        out.push(
          <span key={`k-${d.id}`} data-for={d.id} className={`key${value.cls ? ` key--${value.cls}` : ""}`} style={{ left: kx, top: ky }}>
            {value.text}
          </span>,
        );
      }
    }
  }

  if (values) {
    for (const h of layout.keyHeaders ?? []) {
      const [x, y] = at(view, h.at[0], h.at[1]);
      if (x > limit - EDGE) continue;
      const value = plate(h.metric, "");
      out.push(
        <span key={`h-${h.metric}`} className={`key${h.align === "end" ? " key--end" : ""}${value.cls ? ` key--${value.cls}` : ""}`} style={{ left: x, top: y }}>
          <span className="key__label">{h.label}</span>
          {value.text}
        </span>,
      );
    }
  }
  return <>{out}</>;
}

/**
 * Open issues hang as laminate tags from their first affected item: the most severe
 * in full, others folded to their eyelet until hovered or focused. Tags stay at the
 * top of the stage when panned, and move to a floating panel's edge rather than hide
 * under it.
 */
export function IssueTags({
  topology,
  layout,
  view,
  limit,
  issues,
  onOpen,
  onReach,
}: Common & { issues: Issue[]; onOpen: (issue: Issue) => void; onReach: (ids: string[]) => void }) {
  const s = useStrings();
  const h = s.monitoring.hung;
  const hung = issues.filter((i) => i.equipmentIds.length && layout.nodes[i.equipmentIds[0]]);
  return (
    <>
      {hung.map((issue, n) => {
        const first = issue.equipmentIds[0];
        const node = layout.nodes[first];
        const g = spriteGeometry[node.kind];
        const [ax, ay] = at(view, node.x + g.width, node.y + 10);
        let tx = Math.max(8, ax + 22);
        let ty = Math.max(8, ay - 30 - n * 4);
        let edge = false;
        if (tx + 150 > limit) {
          tx = Math.max(12, limit - 168);
          edge = true;
        }
        const mini = n > 0 && !edge;
        if (mini) {
          tx = Math.max(8, ax + 6);
          ty = Math.max(8, ay - 30);
        }
        const len = Math.hypot(tx - ax, ty + 12 - ay);
        const angle = Math.atan2(ty + 12 - ay, tx - ax);
        const severity = s.issues.severity[issue.severity];
        const sub = issue.equipmentIds.length > 1 ? h.items(issue.equipmentIds.length) : topology.devices.find((d) => d.id === first)?.label ?? first;
        const reach = () => onReach(issue.equipmentIds);
        return (
          <span key={issue.id} className="hang-wrap">
            {!edge && <span className="hang__string" style={{ left: ax, top: ay, width: len, transform: `rotate(${angle}rad)` }} />}
            <span className={`hang${edge ? " hang--edge" : ""}${mini ? " hang--mini" : ""}`} style={{ left: tx, top: ty }}>
              <button
                type="button"
                className={`tag tag--attention tag--sm tag--${issue.severity}`}
                data-issue={issue.id}
                aria-label={h.label(severity, issue.id, issue.title, edge)}
                onClick={() => onOpen(issue)}
                onPointerEnter={reach}
                onPointerLeave={() => onReach([])}
                onFocus={reach}
                onBlur={() => onReach([])}
              >
                <span className="tag__eye" />
                <span className="num">{issue.id}</span>
                <span className="tag__sub">{sub}</span>
              </button>
            </span>
          </span>
        );
      })}
    </>
  );
}
