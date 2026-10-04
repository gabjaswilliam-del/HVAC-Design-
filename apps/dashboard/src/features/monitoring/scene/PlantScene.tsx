import type { Link, LinkEnd, Topology } from "../../../lib/contracts/site";
import { EquipmentNode } from "./EquipmentNode";
import { portPosition } from "./geometry";
import { SpriteDefs } from "./materials";
import { Pipe, type Medium } from "./Pipe";
import { ReadoutTag } from "./ReadoutTag";
import { BowtieValve, Junction, RingValve, Sensor } from "./Symbols";
import type { SceneLayout, SceneReadings } from "./types";
import "./scene.css";

type XY = [number, number];

const BUS_MEDIUM: Record<string, Medium> = {
  cw_supply: "cw-cool",
  cw_return: "cw-hot",
  chw_supply: "chw-supply",
  chw_return: "chw-return",
};

/** Scene colour of a link: its bus's medium, or the supply side of its loop. */
function linkMedium(link: Link): Medium {
  const end = [link.from, link.to].find((e): e is { bus: string } => "bus" in e);
  if (end) return BUS_MEDIUM[end.bus];
  return link.medium === "cw" ? "cw-cool" : "chw-supply";
}

interface PlantSceneProps {
  topology: Topology;
  layout: SceneLayout;
  readings: SceneReadings;
  selectedId?: string | null;
  title: string;
}

/**
 * Renders a site's plant scene from its topology, presentation layout and latest
 * readings. Everything is bound by stable ID: equipment by device ID, pipes by link
 * or bus ID, tags by `device:metric`. Flow animates only on links whose equipment is
 * reported running and current.
 */
export function PlantScene({ topology, layout, readings, selectedId, title }: PlantSceneProps) {
  if (layout.configRevision !== topology.configRevision) {
    throw new Error(
      `Scene revision ${layout.sceneRevision} is for configuration ${layout.configRevision}, not ${topology.configRevision}`,
    );
  }

  const status = (id: string) => readings.equipment[id];
  const isMoving = (id: string) => {
    const s = status(id);
    return s?.state === "running" && !s.stale;
  };

  const endPoint = (end: LinkEnd): XY | null => {
    if (!("device" in end)) return null;
    const node = layout.nodes[end.device];
    const p = portPosition(node.kind, end.port, node, node.flip);
    return [p.x, p.y];
  };

  const linkPipes = topology.links.map((link) => {
    const start = endPoint(link.from);
    const end = endPoint(link.to);
    const waypoints = layout.links[link.id] ?? [];
    const points = [...(start ? [start] : []), ...waypoints, ...(end ? [end] : [])];
    const devicesOnLink = [link.from, link.to].flatMap((e) => ("device" in e ? [e.device] : []));
    const flowing = devicesOnLink.every(isMoving);
    return { link, points, flowing, busEnd: start ? (end ? null : points[points.length - 1]) : points[0] };
  });

  const busFlowing = (busId: string) =>
    linkPipes.some((p) => p.flowing && [p.link.from, p.link.to].some((e) => "bus" in e && e.bus === busId));

  return (
    <svg
      className="plant-scene"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label={title}
    >
      <SpriteDefs />

      {Object.entries(layout.buses).map(([busId, polylines]) =>
        polylines.map((points, i) => (
          <Pipe key={`${busId}-${i}`} points={points} medium={BUS_MEDIUM[busId]} flowing={busFlowing(busId)} />
        )),
      )}

      {Object.entries(layout.bypasses).map(([id, b]) => (
        <Pipe key={id} points={b.points} medium={id.startsWith("cw") ? "cw-hot" : "chw-supply"} flowing={false} />
      ))}

      {linkPipes.map(({ link, points, flowing }) => (
        <Pipe key={link.id} points={points} medium={linkMedium(link)} flowing={flowing} evidence={link.evidence} />
      ))}

      {layout.unconnected.map((u) => (
        <Pipe key={`${u.device}-${u.port}`} points={u.points} medium="chw-supply" flowing={false} evidence="unknown" />
      ))}

      {linkPipes
        .filter((p) => p.busEnd && p.link.evidence !== "unknown")
        .map(({ link, busEnd }) => (
          <Junction key={`j-${link.id}`} x={busEnd![0]} y={busEnd![1]} medium={linkMedium(link)} />
        ))}

      {Object.entries(layout.bypasses).map(([id, b]) => (
        <BowtieValve key={id} x={b.valve[0]} y={b.valve[1]} vertical={b.vertical} state="stopped" />
      ))}

      {Object.entries(layout.ringValves).map(([valveId, [x, y]]) => {
        const valve = topology.valves.find((v) => v.id === valveId);
        const device = valve?.at?.device;
        const link = topology.links.find((l) =>
          [l.from, l.to].some((e) => "device" in e && e.device === device && e.port === valve?.at?.port),
        );
        return (
          <RingValve
            key={valveId}
            x={x}
            y={y}
            medium={link ? linkMedium(link) : "cw-cool"}
            open={device ? isMoving(device) : false}
          />
        );
      })}

      {topology.devices.map((device) => {
        const node = layout.nodes[device.id];
        const s = status(device.id) ?? { state: "unavailable" as const };
        return (
          <EquipmentNode
            key={device.id}
            id={device.id}
            kind={node.kind}
            x={node.x}
            y={node.y}
            flip={node.flip}
            labelAt={node.labelAt}
            label={device.label}
            state={s.state}
            stale={s.stale}
            selected={selectedId === device.id}
            speedHz={readings.values[`${device.id}:frequency_hz`]?.value ?? undefined}
          />
        );
      })}

      {layout.sensors.map((sensor, i) => (
        <Sensor key={i} x={sensor.at[0]} y={sensor.at[1]} letter={sensor.letter} side={sensor.side} />
      ))}

      {layout.captions.map((c) => (
        <text key={c.text} x={c.at[0]} y={c.at[1]} className="scene-caption">
          {c.text}
        </text>
      ))}

      {layout.tags.map((tag) => {
        const reading = readings.values[tag.metric];
        return (
          <ReadoutTag
            key={tag.metric}
            x={tag.at[0]}
            y={tag.at[1]}
            kind={tag.kind}
            unit={tag.unit}
            decimals={tag.decimals}
            label={tag.label}
            labelGap={tag.labelGap}
            width={tag.width}
            value={reading?.value ?? null}
            quality={reading?.quality ?? "unavailable"}
          />
        );
      })}
    </svg>
  );
}
