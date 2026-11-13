/** The review inspector: an item's evidence, and the connection tool for an unconnected port. */
import { useState } from "react";
import { X } from "lucide-react";
import type { Device, Link, Topology } from "../../lib/contracts";
import { useStrings } from "../../lib/i18n";
import type { Evidence, PortFinding } from "./cadSession";
import { endDisplayLabel, evidenceReviewState, linkHasDevice } from "./review";

export function Inspector({ device, link, port, topology, showDirectEvidence = false, onClose, onEvidence, onResolvePort }: {
  device?: Device;
  link?: Link;
  port?: PortFinding;
  topology: Topology;
  showDirectEvidence?: boolean;
  onClose: () => void;
  onEvidence: (value: Evidence) => void;
  onResolvePort?: (port: PortFinding, sourceDeviceId: string) => void;
}) {
  const copy = useStrings().cad;
  if (port && device && onResolvePort) {
    return <PortFindingInspector port={port} device={device} topology={topology} onClose={onClose} onResolve={onResolvePort} />;
  }
  const item = device ?? link;
  if (!item) return <div className="cad-empty">{copy.selectObject}</div>;
  const connections = device ? topology.links.filter((candidate) => linkHasDevice(candidate, device.id)) : [];
  const unconnectedPorts = device ? topology.unconnectedPorts.filter((port) => port.device === device.id) : [];
  const effectiveStatus = evidenceReviewState(item.evidence);
  const statusLabel = showDirectEvidence ? copy.evidenceValues[item.evidence] : copy.reviewStates[effectiveStatus];
  return (
    <div className={`cad-inspector__body${link ? " cad-inspector__body--link" : ""}`} key={item.id}>
      <div className="cad-inspector__top">
        <div className="cad-section-title"><span>{device ? copy.equipment : copy.connection}</span><span className={`cad-evidence cad-evidence--${showDirectEvidence ? evidenceReviewState(item.evidence) : effectiveStatus}`}>{statusLabel}</span></div>
        <button type="button" className="icon-button" onClick={onClose} aria-label={copy.closeInspector}><X size={17} aria-hidden="true" /></button>
      </div>
      <h3>{device ? copy.equipmentName(device.id, device.label) : link?.id}</h3>
      {device && <code>{item.id}</code>}
      {link && <dl><dt>{copy.from}</dt><dd>{endDisplayLabel(link.from, topology, copy.equipmentName)}</dd><dt>{copy.to}</dt><dd>{endDisplayLabel(link.to, topology, copy.equipmentName)}</dd><dt>{copy.medium}</dt><dd>{copy.mediumName(link.medium)}</dd></dl>}
      <label className="cad-field">{device ? copy.equipmentEvidence : copy.evidence}<select value={item.evidence} onChange={(event) => onEvidence(event.target.value as Evidence)}><option value="confirmed">{copy.evidenceValues.confirmed}</option><option value="drawing">{copy.evidenceValues.drawing}</option><option value="inferred">{copy.evidenceValues.inferred}</option><option value="unknown">{copy.evidenceValues.unknown}</option></select></label>
      {link?.note && <p className="cad-note">{copy.linkNote(link.note)}</p>}
      {device && <div className="cad-connection-summary"><span className="cad-connection-summary__line" aria-hidden="true" /><span>{copy.connectionsHighlighted(connections.length)}</span>{unconnectedPorts.length > 0 && <strong>{copy.unresolvedPorts(unconnectedPorts.length)}</strong>}</div>}
    </div>
  );
}

function PortFindingInspector({ port, device, topology, onClose, onResolve }: {
  port: PortFinding;
  device: Device;
  topology: Topology;
  onClose: () => void;
  onResolve: (port: PortFinding, sourceDeviceId: string) => void;
}) {
  const copy = useStrings().cad;
  const candidates = topology.devices.filter((candidate) => candidate.family === "chiller_plant");
  const [sourceDeviceId, setSourceDeviceId] = useState(candidates[0]?.id ?? "");
  return (
    <div className="cad-inspector__body cad-inspector__body--port" key={`${port.device}:${port.port}`}>
      <div className="cad-inspector__top">
        <div className="cad-section-title"><span>{copy.port}</span><span className="cad-evidence cad-evidence--unknown">{copy.reviewStates.unknown}</span></div>
        <button type="button" className="icon-button" onClick={onClose} aria-label={copy.closeInspector}><X size={17} aria-hidden="true" /></button>
      </div>
      <h3>{copy.equipmentName(device.id, device.label)} · {port.port}</h3>
      <code>{port.device}:{port.port}</code>
      <p className="cad-note">{copy.portNote(port.note)}</p>
      <label className="cad-field">
        {copy.connectFrom}
        <select value={sourceDeviceId} onChange={(event) => setSourceDeviceId(event.target.value)}>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>{copy.equipmentName(candidate.id, candidate.label)} · evap_out</option>
          ))}
        </select>
      </label>
      <button type="button" className="button cad-resolve-button" disabled={!sourceDeviceId} onClick={() => onResolve(port, sourceDeviceId)}>
        {copy.createConnection}
      </button>
    </div>
  );
}
