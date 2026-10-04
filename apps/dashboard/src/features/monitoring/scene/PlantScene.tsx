import { useMemo } from "react";
import type { LinkEnd, Topology } from "../../../lib/contracts";
import { BUS_MEDIUM, busesOf, devicesOf, linkMedium } from "../../../lib/topology";
import { EquipmentNode } from "./EquipmentNode";
import { portPosition } from "./geometry";
import { Pipe } from "./Pipe";
import { ReadoutTag } from "./ReadoutTag";
import { BowtieValve, Junction, RingValve, Sensor } from "./Symbols";
import type { SceneLayout, SceneReadings } from "./types";
import "./scene.css";

type XY = [number, number];

export const sceneMatchesTopology = (layout: SceneLayout, topology: Topology) =>
  layout.configRevision === topology.configRevision;

interface PlantSceneProps {
  topology: Topology;
  layout: SceneLayout;
  readings: SceneReadings;
  selectedId?: string | null;
  highlightIds?: string[];
  showTags?: boolean;
  onSelect?: (id: string) => void;
}

/**
 * Draws one site's plant from its topology, presentation layout and latest readings,
 * all bound by stable ID: equipment by device ID, pipes by link/bus ID, tags by
 * `device:metric`. Flow animates only on links whose equipment is running and current.
 * Renders a <g>; the viewport owns the <svg>, sprite definitions and pan/zoom.
 */
export function PlantScene({
  topology,
  layout,
  readings,
  selectedId = null,
  highlightIds = [],
  showTags = true,
  onSelect,
}: PlantSceneProps) {
  const isMoving = (id: string) => {
    const s = readings.equipment[id];
    return s?.state === "running" && !s.stale;
  };

  const endPoint = (end: LinkEnd): XY | null => {
    if (!("device" in end)) return null;
    const node = layout.nodes[end.device];
    const p = portPosition(node.kind, end.port, node, node.flip);
    return [p.x, p.y];
  };

  const geometry = useMemo(
    () =>
      topology.links.map((link) => {
        const start = endPoint(link.from);
        const end = endPoint(link.to);
        const points = [...(start ? [start] : []), ...(layout.links[link.id] ?? []), ...(end ? [end] : [])];
        return { link, points, busEnd: start ? (end ? null : points[points.length - 1]) : points[0] };
      }),
    [topology, layout],
  );

  // Everything directly connected to the selection stays emphasised.
  const related = useMemo(() => {
    const links = new Set<string>();
    const devices = new Set<string>();
    const buses = new Set<string>();
    if (selectedId) {
      for (const link of topology.links) {
        if (!devicesOf(link).includes(selectedId)) continue;
        links.add(link.id);
        devicesOf(link).forEach((d) => devices.add(d));
        busesOf(link).forEach((b) => buses.add(b));
      }
      devices.add(selectedId);
    }
    return { links, devices, buses };
  }, [topology, selectedId]);

  const flowingLinks = new Set(geometry.filter(({ link }) => devicesOf(link).every(isMoving)).map(({ link }) => link.id));
  const busFlowing = (busId: string) => topology.links.some((l) => flowingLinks.has(l.id) && busesOf(l).includes(busId));
  const focus = selectedId !== null && topology.devices.some((d) => d.id === selectedId);

  return (
    <g className={`plant${focus ? " plant--focus" : ""}`}>
      {Object.entries(layout.buses).map(([busId, polylines]) =>
        polylines.map((points, i) => (
          <Pipe
            key={`${busId}-${i}`}
            points={points}
            medium={BUS_MEDIUM[busId]}
            flowing={busFlowing(busId)}
            active={related.buses.has(busId)}
            linkId={busId}
          />
        )),
      )}

      {Object.entries(layout.bypasses).map(([id, b]) => (
        <Pipe key={id} points={b.points} medium={id.startsWith("cw") ? "cw-hot" : "chw-supply"} flowing={false} linkId={id} />
      ))}

      {geometry.map(({ link, points }) => (
        <Pipe
          key={link.id}
          points={points}
          medium={linkMedium(link)}
          flowing={flowingLinks.has(link.id)}
          evidence={link.evidence}
          active={related.links.has(link.id)}
          linkId={link.id}
        />
      ))}

      {layout.unconnected.map((u) => (
        <Pipe
          key={`${u.device}-${u.port}`}
          points={u.points}
          medium="chw-supply"
          flowing={false}
          evidence="unknown"
          active={u.device === selectedId}
        />
      ))}

      {geometry
        .filter((g) => g.busEnd && g.link.evidence !== "unknown")
        .map(({ link, busEnd }) => (
          <Junction key={`j-${link.id}`} x={busEnd![0]} y={busEnd![1]} medium={linkMedium(link)} />
        ))}

      {Object.entries(layout.bypasses).map(([id, b]) => (
        <BowtieValve key={id} x={b.valve[0]} y={b.valve[1]} vertical={b.vertical} state="stopped" />
      ))}

      {Object.entries(layout.ringValves).map(([valveId, [x, y]]) => {
        const valve = topology.valves.find((v) => v.id === valveId);
        const at = valve?.at;
        const link = topology.links.find((l) => [l.from, l.to].some((e) => "device" in e && e.device === at?.device && e.port === at?.port));
        return (
          <RingValve
            key={valveId}
            x={x}
            y={y}
            medium={link ? linkMedium(link) : "cw-cool"}
            open={at ? isMoving(at.device) : false}
          />
        );
      })}

      {topology.devices.map((device) => {
        const node = layout.nodes[device.id];
        if (!node) return null;
        const s = readings.equipment[device.id] ?? { state: "unavailable" as const };
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
            related={related.devices.has(device.id)}
            highlighted={highlightIds.includes(device.id)}
            speedHz={readings.values[`${device.id}:frequency_hz`]?.value ?? undefined}
            onSelect={onSelect}
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

      {showTags &&
        layout.tags.map((tag) => {
          const reading = readings.values[tag.metric];
          const owner = tag.metric.split(":")[0];
          const isRelated = related.devices.has(owner) || related.buses.has(owner);
          // A device's reading selects that device; header readings are display only.
          const selectable = onSelect && owner in layout.nodes;
          return (
            <g
              key={tag.metric}
              className={`tag-wrap${isRelated ? " tag-wrap--related" : ""}${selectable ? " tag-wrap--selectable" : ""}`}
              onClick={selectable ? () => onSelect(owner) : undefined}
            >
              <ReadoutTag
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
            </g>
          );
        })}
    </g>
  );
}
