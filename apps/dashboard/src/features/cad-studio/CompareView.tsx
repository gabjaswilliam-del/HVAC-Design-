/**
 * Compare: a reference (by default the approved one) against a target (by default the latest
 * work), as two synchronized panes, one overlay, or the differences alone. The differences are
 * computed from the two reviews (diff.ts); an uploaded drawing has no extraction, so a side
 * that is a file compares as a file (format, size, bytes), never as a drawing.
 */
import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, CircleCheck, Columns2, Equal, FileDiff, Layers2, ListTree, EqualNot, X } from "lucide-react";
import { demoScene } from "../../fixtures/demoPlant";
import type { Topology } from "../../lib/contracts";
import type { ProjectVersion } from "../../lib/contracts/cadProject";
import { RadioGroup } from "../../components/RadioGroup";
import { useStrings } from "../../lib/i18n";
import { cad, compareSides, referenceId, useCadSession, WORKING, type CompareMode, type LocateRequest, type VersionKey } from "./cadSession";
import { DiffLayer, CadViewport, EngineeringScene, TechnicalGrid } from "./Drawing2D";
import { DrawingToolbar } from "./DrawingToolbar";
import { changeMarks, diffTopologies, type ChangeKind, type TopologyDiff } from "./diff";
import { dateTime } from "./FileSheet";
import { Delta, versionName } from "./HistoryView";
import { endDisplayLabel, formatBytes } from "./review";
import { Thumbnail } from "./Thumbnail";

type Copy = ReturnType<typeof useStrings>["cad"];
const MODE_ICONS = { side: Columns2, overlay: Layers2, diff: FileDiff } as const;

export function CompareView() {
  const copy = useStrings().cad;
  const session = useCadSession();
  const { project, history, reviews, compare } = session;
  const { reference, target } = compareSides(session);
  const approved = referenceId(session);
  const sample = project?.kind === "sample";
  const [changesOpen, setChangesOpen] = useState(false);
  const [locate, setLocate] = useState<LocateRequest>(null);
  const [ghost, setGhost] = useState(40);

  useEffect(() => {
    for (const key of [reference, target]) if (key && key !== WORKING) void cad.loadReview(key);
  }, [reference, target]);

  const side = (key: VersionKey | null): { topology: Topology | null | undefined; version?: ProjectVersion } =>
    key === WORKING ? { topology: session.topology } : { topology: key ? reviews[key] : undefined, version: history.versions.find((v) => v.id === key) };
  const a = side(reference);
  const b = side(target);
  const diff = useMemo(() => (a.topology && b.topology ? diffTopologies(a.topology, b.topology) : null), [a.topology, b.topology]);
  if (!project) return null;

  const label = (key: VersionKey | null) => (key === WORKING ? copy.workingReview : (() => {
    const version = history.versions.find((v) => v.id === key);
    return version ? versionName(version, copy) : "";
  })());
  const options = [
    ...(sample ? [{ value: WORKING, label: copy.workingReview }] : []),
    ...[...history.versions].reverse().map((v) => ({ value: v.id, label: `${versionName(v, copy)}${v.id === approved ? ` · ${copy.approvedReference}` : ""}` })),
  ];
  const enough = history.versions.length >= (sample ? 1 : 2);

  const bar = (
    <div className="cad-compare__bar">
      <label className="cad-picker">
        <span className="cad-picker__label">{copy.reference}</span>
        <select value={reference ?? ""} onChange={(event) => cad.setCompare({ reference: event.target.value })} disabled={!enough}>
          {options.filter((o) => o.value !== WORKING).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {reference && reference === approved && <BadgeCheck className="cad-picker__badge" size={15} aria-label={copy.approvedReference} />}
      </label>
      <label className="cad-picker">
        <span className="cad-picker__label">{copy.target}</span>
        <select value={target ?? ""} onChange={(event) => cad.setCompare({ target: event.target.value })} disabled={!enough}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {enough && reference && reference !== approved && (
        <span className="cad-compare__note">
          {approved ? copy.notApproved : copy.noReference}
          {reference !== WORKING && <button type="button" className="cad-text-button" disabled={!!session.busy} onClick={() => void cad.setReference(reference)}><BadgeCheck size={14} aria-hidden="true" />{copy.approve}</button>}
        </span>
      )}
      <span className="cad-compare__spacer" />
      {diff && (
        <>
          <Summary diff={diff} copy={copy} />
          <RadioGroup<CompareMode>
            label={copy.compareModes}
            className="cad-modes"
            value={compare.mode}
            options={(["side", "overlay", "diff"] as CompareMode[]).map((mode) => {
              const Icon = MODE_ICONS[mode];
              return { value: mode, label: <><Icon size={15} aria-hidden="true" /><span className="cad-modes__text">{copy.modes[mode]}</span></>, name: copy.modes[mode], title: copy.modes[mode] };
            })}
            onChange={(mode) => cad.setCompare({ mode })}
          />
          <button type="button" className="cad-icon-button" aria-pressed={changesOpen} onClick={() => setChangesOpen(!changesOpen)} aria-label={copy.changes} title={copy.changes} disabled={!diff.total}>
            <ListTree size={16} aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  );

  let body;
  if (!enough) {
    body = (
      <div className="cad-empty-state">
        <strong>{copy.noVersions}</strong>
        <span>{sample ? copy.needTwoSample : copy.needTwoDrawing}</span>
        {sample && <button type="button" className="cad-button" disabled={!!session.busy} onClick={() => void cad.saveVersion(copy.newProjectName(copy.sampleName))}>{copy.saveVersion}</button>}
      </div>
    );
  } else if (reference === target) {
    body = <div className="cad-empty-state"><span>{copy.sameVersion}</span></div>;
  } else if (a.topology === undefined || b.topology === undefined) {
    body = <div className="cad-empty-state" role="status">{copy.loadingVersion}</div>;
  } else if (!a.topology || !b.topology || !diff) {
    body = <FileComparison a={a} b={b} labels={[label(reference), label(target)]} />;
  } else {
    body = (
      <div className="cad-compare__stage" data-changes={changesOpen ? "open" : "closed"}>
        <div className="cad-compare__canvas">
          <DiffCanvas key={compare.mode} mode={compare.mode} reference={a.topology} target={b.topology} diff={diff} labels={[label(reference), label(target)]} locate={locate} ghost={ghost} onGhost={setGhost} />
        </div>
        {changesOpen && diff.total > 0 && (
          <ChangeList diff={diff} target={b.topology} onClose={() => setChangesOpen(false)} onLocate={(id) => setLocate({ id, nonce: Date.now() })} />
        )}
      </div>
    );
  }

  return (
    <section className="cad-compare" aria-label={copy.tabs.compare}>
      {bar}
      {body}
    </section>
  );
}

function Summary({ diff, copy }: { diff: TopologyDiff; copy: Copy }) {
  const counts = marksByKind(diff);
  if (!diff.total) return <span className="cad-summary-chip cad-summary-chip--none"><CircleCheck size={14} aria-hidden="true" />{copy.noDifferences}</span>;
  return (
    <span className="cad-diffsum" role="status">
      {counts.added > 0 && <span className="cad-summary-chip cad-diff--added"><span aria-hidden="true">+</span>{copy.added(counts.added)}</span>}
      {counts.removed > 0 && <span className="cad-summary-chip cad-diff--removed"><span aria-hidden="true">−</span>{copy.removed(counts.removed)}</span>}
      {counts.changed > 0 && <span className="cad-summary-chip cad-diff--changed"><span aria-hidden="true">~</span>{copy.changed(counts.changed)}</span>}
    </span>
  );
}

function marksByKind(diff: TopologyDiff) {
  const counts: Record<ChangeKind, number> = { added: 0, removed: 0, changed: 0 };
  changeMarks(diff).forEach((kind) => { counts[kind] += 1; });
  return counts;
}

/** The diff as drawing marks: each side shows what it has that the other does not. */
function marks(diff: TopologyDiff) {
  return {
    links: [
      ...diff.links.added.map((link) => ({ link, kind: "added" as const })),
      ...diff.links.removed.map((link) => ({ link, kind: "removed" as const })),
      ...diff.links.changed.map(({ after }) => ({ link: after, kind: "changed" as const })),
    ],
    devices: [
      ...diff.devices.added.map((d) => ({ id: d.id, kind: "added" as const })),
      ...diff.devices.removed.map((d) => ({ id: d.id, kind: "removed" as const })),
      ...diff.devices.changed.map(({ after }) => ({ id: after.id, kind: "changed" as const })),
    ],
    // A port connected or left open is a change at that port, not an item added or removed.
    ports: [...diff.ports.resolved, ...diff.ports.opened].map((p) => ({ device: p.device, port: p.port, kind: "changed" as const })),
  };
}

function DiffCanvas({ mode, reference, target, diff, labels, locate, ghost, onGhost }: {
  mode: CompareMode;
  reference: Topology;
  target: Topology;
  diff: TopologyDiff;
  labels: [string, string];
  locate: LocateRequest;
  ghost: number;
  onGhost: (value: number) => void;
}) {
  const copy = useStrings().cad;
  const session = useCadSession();
  const scene = demoScene;
  const view = { selection: null, layers: session.layers, colourBy: session.colourBy };
  const m = marks(diff);
  const toolbar = (
    <DrawingToolbar
      layers={session.layers}
      colourBy={session.colourBy}
      onLayer={cad.setLayer}
      onColour={cad.setColourBy}
      legend={<DiffLegend />}
      banner={mode === "overlay" && (
        <label className="cad-banner cad-opacity">
          <span>{copy.referenceOpacity}</span>
          <input type="range" min={10} max={90} step={5} value={ghost} onChange={(event) => onGhost(Number(event.target.value))} aria-label={copy.referenceOpacity} />
          <span className="num">{ghost}%</span>
        </label>
      )}
    />
  );
  if (mode === "side") {
    return (
      <CadViewport
        scene={scene}
        locate={locate}
        ariaLabel={copy.modes.side}
        className="cad-sheet"
        place="compare"
        toolbar={toolbar}
        paneLabels={[<><Delta number={null} reference />{labels[0]}</>, labels[1]]}
        paneNames={[`${copy.reference}: ${labels[0]}`, `${copy.target}: ${labels[1]}`]}
        secondary={<><EngineeringScene {...view} topology={target} scene={scene} /><DiffLayer scene={scene} {...m} show={["added", "changed"]} /></>}
      >
        <EngineeringScene {...view} topology={reference} scene={scene} />
        <DiffLayer scene={scene} {...m} show={["removed", "changed"]} />
      </CadViewport>
    );
  }
  return (
    <CadViewport scene={scene} locate={locate} ariaLabel={copy.modes[mode]} className="cad-sheet" place="compare" toolbar={toolbar} paneNames={[`${copy.modes[mode]}: ${labels[0]} → ${labels[1]}`, ""]}>
      {/* The sheet stays outside the faded, greyed layers, so it keeps the canvas colour. */}
      <TechnicalGrid scene={scene} />
      {mode === "overlay" ? (
        <>
          <g className="cad-layer-reference" style={{ opacity: ghost / 100 }}><EngineeringScene {...view} topology={reference} scene={scene} grid={false} /></g>
          <g className="cad-layer-target"><EngineeringScene {...view} topology={target} scene={scene} grid={false} /></g>
        </>
      ) : (
        <g className="cad-layer-muted"><EngineeringScene {...view} topology={target} scene={scene} grid={false} /></g>
      )}
      <DiffLayer scene={scene} {...m} />
    </CadViewport>
  );
}

function DiffLegend() {
  const copy = useStrings().cad;
  return (
    <>
      {(["added", "removed", "changed"] as const).map((kind) => (
        <span key={kind} className="cad-legend__item"><i className={`cad-swatch cad-swatch--diff cad-diff--${kind}`} aria-hidden="true" />{copy[kind](1).replace(/^1 /, "")}</span>
      ))}
    </>
  );
}

function ChangeList({ diff, target, onClose, onLocate }: { diff: TopologyDiff; target: Topology; onClose: () => void; onLocate: (deviceId: string) => void }) {
  const copy = useStrings().cad;
  const ends = (link: TopologyDiff["links"]["added"][number]) => `${endDisplayLabel(link.from, target, copy.equipmentName)} → ${endDisplayLabel(link.to, target, copy.equipmentName)}`;
  const deviceName = (id: string) => {
    const device = target.devices.find((d) => d.id === id);
    return device ? copy.equipmentName(device.id, device.label) : id;
  };
  const evidence = (before: string, after: string) => `${copy.evidenceValues[before]} → ${copy.evidenceValues[after]}`;
  const firstDevice = (link: TopologyDiff["links"]["added"][number]) => ("device" in link.from ? link.from.device : "device" in link.to ? link.to.device : "");
  const rows: { key: string; kind: ChangeKind; title: string; detail: string; device: string }[] = [
    ...diff.links.added.map((link) => ({ key: `la-${link.id}`, kind: "added" as const, title: copy.change.linkAdded, detail: ends(link), device: firstDevice(link) })),
    ...diff.links.removed.map((link) => ({ key: `lr-${link.id}`, kind: "removed" as const, title: copy.change.linkRemoved, detail: ends(link), device: firstDevice(link) })),
    ...diff.links.changed.map(({ before, after, fields }) => ({
      key: `lc-${after.id}`, kind: "changed" as const, title: copy.change[fields[0]],
      detail: fields.includes("evidence") ? `${ends(after)} · ${evidence(before.evidence, after.evidence)}` : ends(after),
      device: firstDevice(after),
    })),
    ...diff.devices.added.map((d) => ({ key: `da-${d.id}`, kind: "added" as const, title: copy.change.deviceAdded, detail: copy.equipmentName(d.id, d.label), device: d.id })),
    ...diff.devices.removed.map((d) => ({ key: `dr-${d.id}`, kind: "removed" as const, title: copy.change.deviceRemoved, detail: copy.equipmentName(d.id, d.label), device: d.id })),
    ...diff.devices.changed.map(({ before, after }) => ({ key: `dc-${after.id}`, kind: "changed" as const, title: copy.change.deviceEvidence, detail: `${copy.equipmentName(after.id, after.label)} · ${evidence(before.evidence, after.evidence)}`, device: after.id })),
    ...diff.ports.resolved.map((p) => ({ key: `pr-${p.device}-${p.port}`, kind: "changed" as const, title: copy.change.portResolved, detail: `${deviceName(p.device)} ${copy.portNames[p.port] ?? p.port}`, device: p.device })),
    ...diff.ports.opened.map((p) => ({ key: `po-${p.device}-${p.port}`, kind: "changed" as const, title: copy.change.portOpened, detail: `${deviceName(p.device)} ${copy.portNames[p.port] ?? p.port}`, device: p.device })),
  ];
  return (
    <aside className="cad-changes" aria-label={copy.changes}>
      <div className="cad-changes__head">
        <h3>{copy.changes} <span className="num">{diff.total}</span></h3>
        <button type="button" className="cad-icon-button" onClick={onClose} aria-label={copy.closeChanges} title={copy.closeChanges}><X size={16} aria-hidden="true" /></button>
      </div>
      <ul>
        {rows.map((row) => (
          <li key={row.key}>
            <button type="button" className={`cad-change cad-diff--${row.kind}`} onClick={() => row.device && onLocate(row.device)}>
              <span className="cad-change__mark" aria-hidden="true">{row.kind === "added" ? "+" : row.kind === "removed" ? "−" : "~"}</span>
              <span className="cad-change__text"><span className="cad-change__title">{row.title}</span><span className="cad-change__detail">{row.detail}</span></span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/** Two sides of which at least one is an uploaded file: compared as files, never as drawings. */
function FileComparison({ a, b, labels }: { a: { topology: Topology | null | undefined; version?: ProjectVersion }; b: { topology: Topology | null | undefined; version?: ProjectVersion }; labels: [string, string] }) {
  const copy = useStrings().cad;
  const files = [a, b].map((s) => (s.version?.source.kind === "upload" ? s.version.source.original : null));
  const same = files[0] && files[1] ? files[0].sha256 === files[1].sha256 : null;
  return (
    <div className="cad-filecmp">
      <h3 className="visually-hidden">{copy.fileComparison}</h3>
      <div className="cad-filecmp__cards">
        {[a, b].map((s, i) => {
          const file = files[i];
          return (
            <section key={i} className="cad-filecmp__card" aria-label={`${i ? copy.target : copy.reference}: ${labels[i]}`}>
              <span className="cad-picker__label">{i ? copy.target : copy.reference}</span>
              <Thumbnail extension={file?.extension} />
              <strong>{labels[i]}</strong>
              {file ? (
                <dl className="cad-file__facts">
                  <div><dt>{copy.fileSheet.format}</dt><dd>{copy.format(file.extension)}</dd></div>
                  <div><dt>{copy.fileSheet.size}</dt><dd>{formatBytes(file.sizeBytes)}</dd></div>
                  {s.version && <div><dt>{copy.fileSheet.added}</dt><dd>{dateTime(s.version.createdAt)}</dd></div>}
                  <div><dt>SHA-256</dt><dd><code>{file.sha256.slice(0, 12)}…</code></dd></div>
                </dl>
              ) : <span className="cad-tag">{copy.savedReview}</span>}
            </section>
          );
        })}
      </div>
      {same !== null && (
        <p className={`cad-filecmp__verdict${same ? " is-same" : ""}`} role="status">
          {same ? <Equal size={16} aria-hidden="true" /> : <EqualNot size={16} aria-hidden="true" />}
          {same ? copy.identicalFile : copy.differentFile}
        </p>
      )}
      <p className="cad-filecmp__note">{copy.noDrawingToCompare}</p>
    </div>
  );
}
