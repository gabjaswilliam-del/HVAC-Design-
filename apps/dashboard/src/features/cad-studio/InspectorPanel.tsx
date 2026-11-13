/**
 * The Engineering Inspector: Findings first, then every item of equipment with the review of its
 * connections; a selection replaces them (Back to findings). An item's own evidence and the
 * review of its connections are separate rows, so a confirmed chiller with inferred connections
 * reads as exactly that.
 */
import { useLayoutEffect, useRef } from "react";
import { ChevronDown, ChevronLeft, CircleAlert, CircleCheck, CircleHelp, LocateFixed } from "lucide-react";
import type { Device, Link, LinkEnd, Topology } from "../../lib/contracts";
import { useStrings } from "../../lib/i18n";
import { cad, openFindings, useCadSession, type Evidence, type Selection } from "./cadSession";
import { Inspector } from "./Inspector";
import { evidenceReviewState, linkHasDevice } from "./review";

type Copy = ReturnType<typeof useStrings>["cad"];
const FAMILY_ORDER = ["cooling_towers", "chiller_plant", "cooling_water_pump", "chilled_water_pump_pri", "terminal"];

/** "CW pump 4 discharge", or a header's name; the item itself reads as its port alone. */
function endLabel(end: LinkEnd, topology: Topology, copy: Copy, self?: string) {
  if (!("device" in end)) return topology.buses.find((bus) => bus.id === end.bus)?.label ?? end.bus;
  const port = copy.portNames[end.port] ?? end.port;
  if (end.device === self) return port;
  const device = topology.devices.find((d) => d.id === end.device);
  return `${device ? copy.equipmentName(device.id, device.label) : end.device} ${port}`;
}

/** An item of equipment's connection review: what still needs it, by kind. */
function connectionReview(device: Device, topology: Topology, copy: Copy) {
  const links = topology.links.filter((link) => linkHasDevice(link, device.id));
  const count = (evidence: Evidence) => links.filter((link) => link.evidence === evidence).length;
  const ports = topology.unconnectedPorts.filter((port) => port.device === device.id).length;
  const parts = [
    count("inferred") && copy.inferredConnections(count("inferred")),
    count("drawing") && copy.fromDrawingConnections(count("drawing")),
    count("unknown") && copy.unknownConnections(count("unknown")),
    ports && copy.unconnectedPorts(ports),
  ].filter((part): part is string => !!part);
  return { links, needing: links.filter((link) => link.evidence !== "confirmed").length + ports, total: links.length + ports, text: parts.length ? copy.needsReview(parts) : copy.allConfirmed };
}

const EvidenceIcon = ({ evidence }: { evidence: Evidence }) =>
  evidence === "confirmed" ? <CircleCheck size={13} aria-hidden="true" /> : evidence === "unknown" ? <CircleHelp size={13} aria-hidden="true" /> : <CircleAlert size={13} aria-hidden="true" />;

export function InspectorPanel() {
  const copy = useStrings().cad;
  const { topology, selection } = useCadSession();
  const open = openFindings(topology);
  return (
    <aside className="cad-insp" aria-label={copy.inspectorLabel}>
      {selection ? (
        <>
          <button type="button" className="tool-button tool-button--text cad-insp__back" onClick={() => cad.select(null)}>
            <ChevronLeft size={15} aria-hidden="true" />
            {copy.backToFindings}
            <span className="cad-insp__back-count">{copy.openCount(open)}</span>
          </button>
          <Selected selection={selection} topology={topology} />
        </>
      ) : (
        <Overview topology={topology} open={open} />
      )}
    </aside>
  );
}

function Overview({ topology, open }: { topology: Topology; open: number }) {
  const copy = useStrings().cad;
  const unknown = topology.links.filter((link) => link.evidence === "unknown");
  const devices = [...topology.devices].sort((a, b) => FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family));
  const groups = FAMILY_ORDER.map((family) => [family, devices.filter((d) => d.family === family)] as const).filter(([, list]) => list.length);
  const firstDevice = (link: Link) => [link.from, link.to].find((end): end is { device: string; port: string } => "device" in end)?.device ?? "";
  return (
    <>
      <div className="cad-insp__head">
        <h3>{copy.findings}</h3>
        <span className="cad-insp__count">{open ? copy.findingsOpen(open) : copy.noOpenFindings}</span>
      </div>
      {open > 0 && (
        <ul className="cad-finds">
          {unknown.map((link) => (
            <li key={link.id}>
              <button type="button" className="cad-find" onClick={() => cad.locateFinding({ kind: "link", id: link.id }, firstDevice(link))}>
                <CircleAlert size={16} aria-hidden="true" />
                <span>
                  <span className="cad-find__title">{copy.unknownConnection}</span>
                  <span className="cad-find__sub">{endLabel(link.from, topology, copy)} → {endLabel(link.to, topology, copy)}</span>
                </span>
              </button>
            </li>
          ))}
          {topology.unconnectedPorts.map((port) => (
            <li key={`${port.device}-${port.port}`}>
              <button type="button" className="cad-find" onClick={() => cad.locateFinding({ kind: "port", deviceId: port.device, port: port.port }, port.device)}>
                <CircleAlert size={16} aria-hidden="true" />
                <span>
                  <span className="cad-find__title">{copy.unconnectedPort}</span>
                  <span className="cad-find__sub">{endLabel(port, topology, copy)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <section className="cad-equip" aria-labelledby="cad-equip-title">
        <h3 id="cad-equip-title" className="cad-equip__title">
          <ChevronDown size={14} aria-hidden="true" />
          {copy.equipment}
          <span className="num">· {topology.devices.length}</span>
        </h3>
        {groups.map(([family, list]) => (
          <div key={family} className="cad-equip__group">
            <h4>{copy.equipmentGroups[family] ?? family}</h4>
            <ul className="cad-items">
              {list.map((device) => {
                const review = connectionReview(device, topology, copy);
                return (
                  <li key={device.id}>
                    <button type="button" onClick={() => cad.select({ kind: "device", id: device.id })}>
                      <span className="cad-items__name">
                        {copy.equipmentName(device.id, device.label)}
                        {device.role === "standby" && <small>{copy.standby}</small>}
                      </span>
                      <span className={`cad-state cad-state--${review.needing ? "review" : "ok"}`}>
                        {review.needing ? <CircleAlert size={13} aria-hidden="true" /> : <CircleCheck size={13} aria-hidden="true" />}
                        {review.text}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>
    </>
  );
}

function Selected({ selection, topology }: { selection: Exclude<Selection, null>; topology: Topology }) {
  const deviceId = selection.kind === "device" ? selection.id : selection.kind === "port" ? selection.deviceId : undefined;
  const device = deviceId ? topology.devices.find((d) => d.id === deviceId) : undefined;
  if (selection.kind === "device" && device) return <DeviceReview device={device} topology={topology} />;
  const link = selection.kind === "link" ? topology.links.find((l) => l.id === selection.id) : undefined;
  const port = selection.kind === "port" ? topology.unconnectedPorts.find((p) => p.device === selection.deviceId && p.port === selection.port) : undefined;
  return (
    <div className="cad-inspector">
      <Inspector device={device} link={link} port={port} topology={topology} onClose={() => cad.select(null)} onEvidence={cad.setEvidence} onResolvePort={cad.resolvePort} />
    </div>
  );
}

function DeviceReview({ device, topology }: { device: Device; topology: Topology }) {
  const copy = useStrings().cad;
  const heading = useRef<HTMLHeadingElement>(null);
  const name = copy.equipmentName(device.id, device.label);
  const review = connectionReview(device, topology, copy);
  const ports = topology.unconnectedPorts.filter((port) => port.device === device.id);
  // A selection made in the Inspector moves focus to what it shows.
  useLayoutEffect(() => {
    if (document.activeElement?.closest(".cad-insp")) heading.current?.focus({ preventScroll: true });
  }, [device.id]);
  return (
    <section className="cad-review" aria-labelledby="cad-review-title" key={device.id}>
      <div className="cad-review__head">
        <h3 ref={heading} id="cad-review-title" tabIndex={-1}>
          {name}
          {device.role === "standby" && <small>{copy.standby}</small>}
        </h3>
        <button type="button" className="icon-button" aria-label={copy.locate(name)} title={copy.locate(name)} onClick={() => cad.locateFinding({ kind: "device", id: device.id }, device.id)}>
          <LocateFixed size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="cad-review__rows">
        <label className="cad-kv">
          <span>{copy.equipmentEvidence}</span>
          <select className="select" value={device.evidence} onChange={(event) => cad.setEvidence(event.target.value as Evidence)}>
            {(["confirmed", "drawing", "inferred", "unknown"] as const).map((value) => <option key={value} value={value}>{copy.evidenceValues[value]}</option>)}
          </select>
        </label>
        <div className="cad-kv">
          <span>{copy.connectionsNeedingReview}</span>
          <span className={`cad-state cad-state--strong cad-state--${review.needing ? "review" : "ok"}`}>
            {review.needing ? <CircleAlert size={14} aria-hidden="true" /> : <CircleCheck size={14} aria-hidden="true" />}
            {copy.ofCount(review.needing, review.total)}
          </span>
        </div>
      </div>
      <h4>{copy.connectionsCount(review.total)}</h4>
      <ul className="cad-items cad-items--connections">
        {review.links.map((link) => (
          <li key={link.id}>
            <button type="button" onClick={() => cad.select({ kind: "link", id: link.id })}>
              <span>{endLabel(link.from, topology, copy, device.id)} → {endLabel(link.to, topology, copy, device.id)}</span>
              <span className={`cad-state cad-state--${evidenceReviewState(link.evidence) === "confirmed" ? "ok" : "review"}`}>
                <EvidenceIcon evidence={link.evidence} />
                {copy.evidenceValues[link.evidence]}
              </span>
            </button>
          </li>
        ))}
        {ports.map((port) => (
          <li key={port.port}>
            <button type="button" onClick={() => cad.select({ kind: "port", deviceId: device.id, port: port.port })}>
              <span>{copy.portNames[port.port] ?? port.port}</span>
              <span className="cad-state cad-state--review"><CircleAlert size={13} aria-hidden="true" />{copy.unconnected}</span>
            </button>
          </li>
        ))}
      </ul>
      {device.nameplate.length > 0 && (
        <>
          <h4>{copy.nameplate}</h4>
          <dl className="cad-plate">
            {device.nameplate.map((row) => (
              <div key={row.label}><dt>{row.label}</dt><dd><span className="num">{row.value}</span> {row.unit}</dd></div>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}
