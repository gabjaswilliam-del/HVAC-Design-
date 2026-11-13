/**
 * A project's thumbnail, drawn from its own data: the sample plant in miniature (pipes in their
 * media colours, equipment in grey). A drawing has no extraction, so it is a file tile with its
 * format, never a preview.
 */
import { FileText } from "lucide-react";
import type { LinkEnd } from "../../lib/contracts";
import { demoScene, demoTopology } from "../../fixtures/demoPlant";
import { BUS_MEDIUM, linkMedium } from "../../lib/topology";
import { portPosition, spriteGeometry } from "../monitoring/scene/geometry";

type Point = [number, number];

/** The sample's plan, computed once: every sample-based project shares it. */
const PLAN = (() => {
  const scene = demoScene;
  const port = (end: LinkEnd): Point | null => {
    if (!("device" in end)) return null;
    const node = scene.nodes[end.device];
    const p = portPosition(node.kind, end.port, node, node.flip);
    return [p.x, p.y];
  };
  const lines: { points: string; medium: string; width: number }[] = [];
  const add = (points: Point[], medium: string, width: number) => lines.push({ points: points.map((p) => p.join(",")).join(" "), medium, width });
  for (const [bus, groups] of Object.entries(scene.buses)) for (const points of groups) add(points, BUS_MEDIUM[bus], 30);
  for (const link of demoTopology.links) {
    const mid = scene.links[link.id] ?? [];
    const from = port(link.from), to = port(link.to);
    const points = [from ?? mid[0], ...mid.slice(from ? 0 : 1, to ? mid.length : -1), to ?? mid.at(-1)].filter((p): p is Point => !!p);
    add(points, link.evidence === "unknown" ? "unknown" : linkMedium(link), 20);
  }
  const nodes = Object.values(scene.nodes).map((node) => ({ x: node.x, y: node.y, ...spriteGeometry[node.kind] }));
  const busPoints: Point[] = Object.values(scene.buses).flatMap((groups) => groups.flat());
  const xs = [...nodes.flatMap((n) => [n.x, n.x + n.width]), ...busPoints.map((p) => p[0])];
  const ys = [...nodes.flatMap((n) => [n.y, n.y + n.height]), ...busPoints.map((p) => p[1])];
  const pad = 40, x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
  return { lines, nodes, viewBox: `${x0} ${y0} ${Math.max(...xs) + pad - x0} ${Math.max(...ys) + pad - y0}` };
})();

export function Thumbnail({ extension }: { extension?: string }) {
  if (extension) {
    return (
      <span className="cad-thumb cad-thumb--file">
        <FileText size={13} aria-hidden="true" />
        {extension.toUpperCase()}
      </span>
    );
  }
  return (
    <span className="cad-thumb">
      <svg viewBox={PLAN.viewBox} aria-hidden="true" focusable="false">
        {PLAN.lines.map((line, i) => (
          <polyline key={i} points={line.points} className={`cad-thumb__pipe cad-thumb__pipe--${line.medium}`} strokeWidth={line.width} />
        ))}
        {PLAN.nodes.map((node, i) => (
          <rect key={i} x={node.x} y={node.y} width={node.width} height={node.height} rx={10} className="cad-thumb__node" />
        ))}
      </svg>
    </span>
  );
}
