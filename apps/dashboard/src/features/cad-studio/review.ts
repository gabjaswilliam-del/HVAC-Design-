/** Review rules for the extracted topology: a state per item, and the names shown for link ends. */
import type { Link, Topology } from "../../lib/contracts";
import type { Evidence } from "./cadSession";

export type ReviewState = "confirmed" | "review" | "unknown";

export function evidenceReviewState(evidence: Evidence): ReviewState {
  if (evidence === "confirmed") return "confirmed";
  if (evidence === "unknown") return "unknown";
  return "review";
}

/** Equipment's review state: the worst of its own evidence, its connections' and any unconnected port. */
export function deviceReviewState(deviceId: string, topology: Topology): ReviewState {
  const device = topology.devices.find((candidate) => candidate.id === deviceId);
  const states = [device ? evidenceReviewState(device.evidence) : "unknown", ...topology.links.filter((link) => linkHasDevice(link, deviceId)).map((link) => evidenceReviewState(link.evidence))] as ReviewState[];
  if (topology.unconnectedPorts.some((port) => port.device === deviceId)) states.push("unknown");
  const priority: Record<ReviewState, number> = { confirmed: 0, review: 1, unknown: 2 };
  return states.reduce((worst, state) => (priority[state] > priority[worst] ? state : worst), "confirmed");
}

export function linkHasDevice(link: Link, deviceId: string) {
  return ("device" in link.from && link.from.device === deviceId) || ("device" in link.to && link.to.device === deviceId);
}

export function firstDeviceId(link?: Link) {
  if (!link) return null;
  if ("device" in link.from) return link.from.device;
  if ("device" in link.to) return link.to.device;
  return null;
}

export function deviceIds(link: Link) {
  return [link.from, link.to].flatMap((end) => ("device" in end ? [end.device] : []));
}

export function endDisplayLabel(end: Link["from"], topology: Topology, equipmentName: (id: string, label: string) => string) {
  if (!("device" in end)) {
    const bus = topology.buses.find((candidate) => candidate.id === end.bus);
    return bus ? equipmentName(bus.id, bus.label) : end.bus;
  }
  const device = topology.devices.find((candidate) => candidate.id === end.device);
  return `${device ? equipmentName(device.id, device.label) : end.device}:${end.port}`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
