/**
 * The Engineering Inspector: identity and connections in Properties, unresolved items in
 * Findings, and evidence editing in Evidence. Equipment evidence stays separate from the
 * review of its connections.
 */
import { createContext, use, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, CircleAlert, CircleCheck, CircleHelp, LocateFixed, X } from "lucide-react";
import type { Device, Link, LinkEnd, Topology } from "../../lib/contracts";
import { useStrings } from "../../lib/i18n";
import { cad, openFindings, useCadSession, type Evidence, type Selection } from "./cadSession";
import { Inspector } from "./Inspector";
import { evidenceReviewState, linkHasDevice } from "./review";

type Copy = ReturnType<typeof useStrings>["cad"];
type InspectorTab = "properties" | "findings" | "evidence";
/** A saved version is shown read-only: its evidence cannot be edited. */
const ReadOnly = createContext(false);
const FAMILY_ORDER = ["cooling_towers", "chiller_plant", "cooling_water_pump", "chilled_water_pump_pri", "terminal"];

function endLabel(end: LinkEnd, topology: Topology, copy: Copy, self?: string) {
  if (!("device" in end)) return topology.buses.find((bus) => bus.id === end.bus)?.label ?? end.bus;
  const port = copy.portNames[end.port] ?? end.port;
  if (end.device === self) return port;
  const device = topology.devices.find((d) => d.id === end.device);
  return `${device ? copy.equipmentName(device.id, device.label) : end.device} ${port}`;
}

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

export function InspectorPanel({ topology: shown, readOnly = false, onClose }: { topology?: Topology; readOnly?: boolean; onClose?: () => void }) {
  const copy = useStrings().cad;
  const session = useCadSession();
  const topology = shown ?? session.topology;
  const { selection } = session;
  const [tab, setTab] = useState<InspectorTab>("findings");
  const selectionKey = selection ? selection.kind === "port" ? `${selection.deviceId}:${selection.port}` : selection.id : "";
  useEffect(() => {
    if (!selection) return setTab("findings");
    if (selection.kind === "port" || (selection.kind === "link" && topology.links.find((link) => link.id === selection.id)?.evidence === "unknown")) setTab("findings");
    else setTab("properties");
  }, [selectionKey]);

  return (
    <ReadOnly value={readOnly}>
    <aside className="cad-insp" aria-label={copy.inspectorLabel}>
      <div className="cad-insp__top">
        <InspectorTabs active={tab} onChange={setTab} />
        {onClose && <button type="button" className="cad-icon-button" onClick={onClose} aria-label={copy.closeReview} title={copy.closeReview}><X size={16} aria-hidden="true" /></button>}
      </div>
      <section className="cad-insp__panel" id="cad-inspector-panel" role="tabpanel" aria-labelledby={`cad-inspector-tab-${tab}`} tabIndex={0}>
        {selection && (
          <button type="button" className="tool-button tool-button--text cad-insp__back" onClick={() => cad.select(null)}>
            <ChevronLeft size={15} aria-hidden="true" />
            {copy.backToFindings}
            <span className="cad-insp__back-count">{copy.openCount(openFindings(topology))}</span>
          </button>
        )}
        {tab === "properties" && (selection ? <Selected selection={selection} topology={topology} tab={tab} /> : <><ProjectSummary topology={topology} /><EquipmentIndex topology={topology} /></>)}
        {tab === "findings" && (
          <>
            {!selection && <ProjectSummary topology={topology} />}
            <FindingsList topology={topology} />
            {selection && <Selected selection={selection} topology={topology} tab="evidence" />}
          </>
        )}
        {tab === "evidence" && (selection ? <Selected selection={selection} topology={topology} tab={tab} /> : <EvidenceOverview topology={topology} />)}
      </section>
    </aside>
    </ReadOnly>
  );
}

function InspectorTabs({ active, onChange }: { active: InspectorTab; onChange: (tab: InspectorTab) => void }) {
  const copy = useStrings().cad;
  const prefix = useId();
  const tabs: { key: InspectorTab; label: string }[] = [
    { key: "properties", label: copy.properties },
    { key: "findings", label: copy.findings },
    { key: "evidence", label: copy.evidence },
  ];
  const choose = (tab: InspectorTab) => {
    onChange(tab);
    document.getElementById(`${prefix}-${tab}`)?.focus();
  };
  return (
    <div className="cad-insp__tabs" role="tablist" aria-label={copy.inspectorSections} onKeyDown={(event) => {
      const current = tabs.findIndex((tab) => tab.key === active);
      let next: number | undefined;
      if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
      if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      choose(tabs[next].key);
    }}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          id={`${prefix}-${tab.key}`}
          className="cad-insp__tab"
          aria-selected={active === tab.key}
          aria-controls="cad-inspector-panel"
          tabIndex={active === tab.key ? 0 : -1}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function ProjectSummary({ topology }: { topology: Topology }) {
  const copy = useStrings().cad;
  const open = openFindings(topology);
  return (
    <section className="cad-summary" aria-labelledby="cad-summary-title">
      <h3 id="cad-summary-title">{copy.projectSummary}</h3>
      <dl>
        <div><dt>{copy.equipment}</dt><dd className="num">{topology.devices.length}</dd></div>
        <div><dt>{copy.connections}</dt><dd className="num">{topology.links.length}</dd></div>
        <div><dt>{copy.headers}</dt><dd className="num">{topology.buses.length}</dd></div>
        <div><dt>{copy.findings}</dt><dd className="num">{copy.findingsOpen(open)}</dd></div>
      </dl>
    </section>
  );
}

function FindingsList({ topology }: { topology: Topology }) {
  const copy = useStrings().cad;
  const open = openFindings(topology);
  const unknown = topology.links.filter((link) => link.evidence === "unknown");
  const firstDevice = (link: Link) => [link.from, link.to].find((end): end is { device: string; port: string } => "device" in end)?.device ?? "";
  return (
    <section aria-labelledby="cad-findings-title">
      <div className="cad-insp__head">
        <h3 id="cad-findings-title">{copy.findings}</h3>
        <span className="cad-insp__count">{open ? copy.findingsOpen(open) : copy.noOpenFindings}</span>
      </div>
      {open > 0 && (
        <ul className="cad-finds">
          {unknown.map((link) => (
            <li key={link.id}>
              <button type="button" className="cad-find" onClick={() => cad.locateFinding({ kind: "link", id: link.id }, firstDevice(link))}>
                <CircleAlert size={16} aria-hidden="true" />
                <span><span className="cad-find__title">{copy.unknownConnection}</span><span className="cad-find__sub">{endLabel(link.from, topology, copy)} → {endLabel(link.to, topology, copy)}</span></span>
              </button>
            </li>
          ))}
          {topology.unconnectedPorts.map((port) => (
            <li key={`${port.device}-${port.port}`}>
              <button type="button" className="cad-find" onClick={() => cad.locateFinding({ kind: "port", deviceId: port.device, port: port.port }, port.device)}>
                <CircleAlert size={16} aria-hidden="true" />
                <span><span className="cad-find__title">{copy.unconnectedPort}</span><span className="cad-find__sub">{endLabel(port, topology, copy)}</span></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EquipmentIndex({ topology }: { topology: Topology }) {
  const copy = useStrings().cad;
  const devices = [...topology.devices].sort((a, b) => FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family));
  const groups = FAMILY_ORDER.map((family) => [family, devices.filter((device) => device.family === family)] as const).filter(([, list]) => list.length);
  return (
    <section className="cad-equip" aria-labelledby="cad-equip-title">
      <h3 id="cad-equip-title" className="cad-equip__title"><ChevronDown size={14} aria-hidden="true" />{copy.equipment}<span className="num">· {topology.devices.length}</span></h3>
      {groups.map(([family, list]) => (
        <div key={family} className="cad-equip__group">
          <h4>{copy.equipmentGroups[family] ?? family}</h4>
          <ul className="cad-items">
            {list.map((device) => {
              const review = connectionReview(device, topology, copy);
              return (
                <li key={device.id}>
                  <button type="button" onClick={() => cad.select({ kind: "device", id: device.id })}>
                    <span className="cad-items__name">{copy.equipmentName(device.id, device.label)}{device.role === "standby" && <small>{copy.standby}</small>}</span>
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
  );
}

function EvidenceOverview({ topology }: { topology: Topology }) {
  const copy = useStrings().cad;
  return (
    <section className="cad-evidence-overview">
      <div className="cad-insp__head"><h3>{copy.evidence}</h3></div>
      <dl className="cad-evidence-breakdown">
        {(["confirmed", "drawing", "inferred", "unknown"] as const).map((value) => (
          <div key={value}><dt>{copy.evidenceValues[value]}</dt><dd className="num">{topology.links.filter((link) => link.evidence === value).length}</dd></div>
        ))}
      </dl>
      <p className="cad-note">{copy.selectEvidencePrompt}</p>
    </section>
  );
}

function Selected({ selection, topology, tab }: { selection: Exclude<Selection, null>; topology: Topology; tab: InspectorTab }) {
  const deviceId = selection.kind === "device" ? selection.id : selection.kind === "port" ? selection.deviceId : undefined;
  const device = deviceId ? topology.devices.find((d) => d.id === deviceId) : undefined;
  if (selection.kind === "device" && device) return tab === "evidence" ? <DeviceEvidence device={device} topology={topology} /> : <DeviceProperties device={device} topology={topology} />;
  const link = selection.kind === "link" ? topology.links.find((candidate) => candidate.id === selection.id) : undefined;
  const port = selection.kind === "port" ? topology.unconnectedPorts.find((candidate) => candidate.device === selection.deviceId && candidate.port === selection.port) : undefined;
  return (
    <div className="cad-inspector">
      <Inspector device={device} link={link} port={port} topology={topology} section={tab === "properties" ? "properties" : "evidence"} readOnly={use(ReadOnly)} onClose={() => cad.select(null)} onEvidence={cad.setEvidence} onResolvePort={cad.resolvePort} />
    </div>
  );
}

function DeviceHeading({ device }: { device: Device }) {
  const copy = useStrings().cad;
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    if (document.activeElement?.closest(".cad-insp")) heading.current?.focus({ preventScroll: true });
  }, [device.id]);
  return (
    <div className="cad-review__head">
      <h3 ref={heading} id="cad-review-title" tabIndex={-1}>{copy.equipmentName(device.id, device.label)}{device.role === "standby" && <small>{copy.standby}</small>}</h3>
      <button type="button" className="icon-button" aria-label={copy.locate(copy.equipmentName(device.id, device.label))} title={copy.locate(copy.equipmentName(device.id, device.label))} onClick={() => cad.locateFinding({ kind: "device", id: device.id }, device.id)}>
        <LocateFixed size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

function DeviceProperties({ device, topology }: { device: Device; topology: Topology }) {
  const copy = useStrings().cad;
  const review = connectionReview(device, topology, copy);
  return (
    <section className="cad-review" aria-labelledby="cad-review-title" key={device.id}>
      <DeviceHeading device={device} />
      <div className="cad-review__rows">
        <div className="cad-kv">
          <span>{copy.connectionsNeedingReview}</span>
          <span className={`cad-state cad-state--strong cad-state--${review.needing ? "review" : "ok"}`}>
            {review.needing ? <CircleAlert size={14} aria-hidden="true" /> : <CircleCheck size={14} aria-hidden="true" />}
            {copy.ofCount(review.needing, review.total)}
          </span>
        </div>
      </div>
      <ConnectionList device={device} topology={topology} />
      {device.nameplate.length > 0 && (
        <>
          <h4>{copy.nameplate}</h4>
          <dl className="cad-plate">
            {device.nameplate.map((row) => <div key={row.label}><dt>{row.label}</dt><dd><span className="num">{row.value}</span> {row.unit}</dd></div>)}
          </dl>
        </>
      )}
    </section>
  );
}

function DeviceEvidence({ device, topology }: { device: Device; topology: Topology }) {
  const copy = useStrings().cad;
  const review = connectionReview(device, topology, copy);
  return (
    <section className="cad-review" aria-labelledby="cad-review-title" key={device.id}>
      <DeviceHeading device={device} />
      <div className="cad-review__rows">
        <label className="cad-kv">
          <span>{copy.equipmentEvidence}</span>
          <select className="select" value={device.evidence} disabled={use(ReadOnly)} onChange={(event) => cad.setEvidence(event.target.value as Evidence)}>
            {(["confirmed", "drawing", "inferred", "unknown"] as const).map((value) => <option key={value} value={value}>{copy.evidenceValues[value]}</option>)}
          </select>
        </label>
      </div>
      <div className="cad-evidence-note">
        <span>{copy.connectionsNeedingReview}</span>
        <span className={`cad-state cad-state--${review.needing ? "review" : "ok"}`}>{review.text}</span>
      </div>
      <ConnectionList device={device} topology={topology} />
    </section>
  );
}

function ConnectionList({ device, topology }: { device: Device; topology: Topology }) {
  const copy = useStrings().cad;
  const review = connectionReview(device, topology, copy);
  const ports = topology.unconnectedPorts.filter((port) => port.device === device.id);
  return (
    <>
      <h4>{copy.connectionsCount(review.total)}</h4>
      <ul className="cad-items cad-items--connections">
        {review.links.map((link) => (
          <li key={link.id}>
            <button type="button" onClick={() => cad.select({ kind: "link", id: link.id })}>
              <span>{endLabel(link.from, topology, copy, device.id)} → {endLabel(link.to, topology, copy, device.id)}</span>
              <span className={`cad-state cad-state--${evidenceReviewState(link.evidence) === "confirmed" ? "ok" : "review"}`}><EvidenceIcon evidence={link.evidence} />{copy.evidenceValues[link.evidence]}</span>
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
    </>
  );
}
