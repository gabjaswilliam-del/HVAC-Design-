/**
 * The difference between two reviewed topologies (a reference and a target), computed from
 * their own data: connections added, removed or changed (evidence, ends or medium), equipment
 * whose evidence changed (or that was added or removed), and unconnected ports resolved or
 * newly open. Nothing is inferred beyond what the two topologies record.
 */
import type { Device, Link, LinkEnd, Topology } from "../../lib/contracts";

export type PortFinding = Topology["unconnectedPorts"][number];
export type LinkField = "evidence" | "ends" | "medium";
export type ChangeKind = "added" | "removed" | "changed";

export interface TopologyDiff {
  links: { added: Link[]; removed: Link[]; changed: { before: Link; after: Link; fields: LinkField[] }[] };
  devices: { added: Device[]; removed: Device[]; changed: { before: Device; after: Device }[] };
  ports: { resolved: PortFinding[]; opened: PortFinding[] };
  /** Every difference counted once. */
  total: number;
}

const endKey = (end: LinkEnd) => ("device" in end ? `${end.device}:${end.port}` : `bus:${end.bus}`);
const portKey = (port: PortFinding) => `${port.device}:${port.port}`;
const byId = <T extends { id: string }>(items: T[]) => new Map(items.map((item) => [item.id, item]));

export function diffTopologies(reference: Topology, target: Topology): TopologyDiff {
  const refLinks = byId(reference.links);
  const nextLinks = byId(target.links);
  const links: TopologyDiff["links"] = {
    added: target.links.filter((link) => !refLinks.has(link.id)),
    removed: reference.links.filter((link) => !nextLinks.has(link.id)),
    changed: [],
  };
  for (const after of target.links) {
    const before = refLinks.get(after.id);
    if (!before) continue;
    const fields: LinkField[] = [];
    if (before.evidence !== after.evidence) fields.push("evidence");
    if (endKey(before.from) !== endKey(after.from) || endKey(before.to) !== endKey(after.to)) fields.push("ends");
    if (before.medium !== after.medium) fields.push("medium");
    if (fields.length) links.changed.push({ before, after, fields });
  }

  const refDevices = byId(reference.devices);
  const nextDevices = byId(target.devices);
  const devices: TopologyDiff["devices"] = {
    added: target.devices.filter((device) => !refDevices.has(device.id)),
    removed: reference.devices.filter((device) => !nextDevices.has(device.id)),
    changed: target.devices.flatMap((after) => {
      const before = refDevices.get(after.id);
      return before && before.evidence !== after.evidence ? [{ before, after }] : [];
    }),
  };

  const refPorts = new Set(reference.unconnectedPorts.map(portKey));
  const nextPorts = new Set(target.unconnectedPorts.map(portKey));
  const ports = {
    resolved: reference.unconnectedPorts.filter((port) => !nextPorts.has(portKey(port))),
    opened: target.unconnectedPorts.filter((port) => !refPorts.has(portKey(port))),
  };

  const total =
    links.added.length + links.removed.length + links.changed.length +
    devices.added.length + devices.removed.length + devices.changed.length +
    ports.resolved.length + ports.opened.length;
  return { links, devices, ports, total };
}

/** Each item's change, for drawing: link and equipment IDs, and ports as `device:port`. */
export function changeMarks(diff: TopologyDiff) {
  const marks = new Map<string, ChangeKind>();
  diff.links.added.forEach((link) => marks.set(link.id, "added"));
  diff.links.removed.forEach((link) => marks.set(link.id, "removed"));
  diff.links.changed.forEach(({ after }) => marks.set(after.id, "changed"));
  diff.devices.added.forEach((device) => marks.set(device.id, "added"));
  diff.devices.removed.forEach((device) => marks.set(device.id, "removed"));
  diff.devices.changed.forEach(({ after }) => marks.set(after.id, "changed"));
  // A port connected or left open is a change at that port.
  diff.ports.resolved.forEach((port) => marks.set(portKey(port), "changed"));
  diff.ports.opened.forEach((port) => marks.set(portKey(port), "changed"));
  return marks;
}
