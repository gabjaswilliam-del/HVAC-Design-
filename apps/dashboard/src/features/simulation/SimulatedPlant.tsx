import { useMemo, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { X } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { formatReading, formatTime } from "../../lib/format";
import type { Issue, SiteBundle, Snapshot } from "../../lib/contracts";
import type { HeldOverride, PilotIssue, PilotStage, RunDetail } from "../../lib/contracts/simulation";
import { StateLabel } from "../../components/StateLabel";
import { targetPath } from "../../app/navigation";
import { PlantViewport, sceneMatchesTopology } from "../monitoring";

const NO_IDS: string[] = [];

// The pilot's lifecycle stage in the words of the plant's issue tags.
const TAG_STATUS: Record<PilotStage, Issue["status"]> = {
  detection: "detected",
  investigation: "investigating",
  proposal: "correction_proposed",
  application: "monitoring",
  outcome: "monitoring",
  resolution: "resolved",
};
const RANK = { critical: 0, warning: 1, info: 2 };

/** Open pilot issues hang on the simulated plant the way telemetry issues hang on the Overview. */
const asTags = (issues: PilotIssue[]): Issue[] =>
  issues
    .filter((i) => i.open)
    .sort((a, b) => RANK[a.severity] - RANK[b.severity])
    .map((i) => ({
      id: i.id,
      title: i.title,
      severity: i.severity,
      status: TAG_STATUS[i.stage],
      equipmentIds: i.equipmentIds,
      firstSeen: i.firstSeen,
      lastSeen: i.lastSeen,
      summary: i.reasoning.summary ?? i.title,
      evidence: [],
    }));

/**
 * The plant drawing, fed one of the run's recorded observations instead of telemetry (its
 * newest unless `frame` is given), with the pilot's open issues hanging on it, in a
 * recorded run's replay. Equipment chosen on it is kept in the address (`?equipment=`);
 * `children` (the replay's scrubber) sit under the drawing.
 */
export function SimulatedPlant({
  run,
  frame = run.frame,
  held = run.overrides,
  site,
  timeZone,
  issues,
  children,
}: {
  run: RunDetail;
  frame?: Snapshot | null;
  /** What the run held at that observation. */
  held?: HeldOverride[];
  site: SiteBundle;
  timeZone: string;
  issues: PilotIssue[];
  children?: ReactNode;
}) {
  const s = useStrings().simulation;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const selected = params.get("equipment");
  const select = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("equipment", id);
    else next.delete("equipment");
    setParams(next, { replace: true });
  };
  const tags = useMemo(() => asTags(issues), [issues]);
  const retained = run.state === "failed" && frame && frame.at === run.frame?.at;
  return (
    <section className="sim-section sim-plant" aria-labelledby="sim-plant-title">
      <div className="sim-section__head">
        <h2 id="sim-plant-title">{frame ? s.plantAt(formatTime(frame.at, timeZone)) : s.plant}</h2>
        {retained && (
          <span className="tag-chip tag-chip--caution" data-retained>
            {s.retained(formatTime(frame.at, timeZone))}
          </span>
        )}
      </div>
      {!frame ? (
        <p className="sim-empty">{s.noFrame}</p>
      ) : sceneMatchesTopology(site.scene, site.topology) ? (
        <div className="sim-plant__box" data-sim-frame={frame.at}>
          <PlantViewport
            topology={site.topology}
            layout={site.scene}
            readings={frame}
            metrics={site.metrics}
            issues={tags}
            selectedId={selected}
            highlightIds={NO_IDS}
            onSelect={select}
            onOpenIssue={(issue) => navigate(targetPath({ type: "simulation", runId: run.runId, issueId: issue.id }))}
            float={false}
            inPage
            note={{ tag: s.label, text: s.plantNote(run.runId), title: s.plantNoteTitle }}
          />
        </div>
      ) : (
        <p className="sim-empty">{s.noScene}</p>
      )}
      {children}
      {frame && selected && <SelectedEquipment frame={frame} held={held} site={site} id={selected} onClear={() => select(null)} />}
    </section>
  );
}

/** The chosen item on the simulated plant: its simulated state and readings at the shown
 *  observation, and what was held on it then. Simulated values only; the telemetry
 *  inspector is not used here. */
function SelectedEquipment({ frame, held: all, site, id, onClear }: { frame: Snapshot; held: HeldOverride[]; site: SiteBundle; id: string; onClear: () => void }) {
  const s = useStrings();
  const t = s.simulation;
  const device = site.topology.devices.find((d) => d.id === id);
  if (!device) return null;
  const status = frame.equipment[id];
  const metrics = site.metrics.filter((m) => m.key.startsWith(`${id}:`));
  const held = all.filter((o) => o.equipmentId === id);
  return (
    <div className="sim-selected" role="region" aria-labelledby="sim-selected-title" data-selected={id}>
      <div className="sim-selected__head">
        <h3 id="sim-selected-title">{device.label}</h3>
        {status && <StateLabel state={status.state} />}
        <span className="sim-muted num">{t.selectedAt(id, formatTime(frame.at, site.site.timezone))}</span>
        <button type="button" className="icon-button" aria-label={t.clearSelection(device.label)} title={t.clearSelection(device.label)} onClick={onClear}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {metrics.length > 0 && (
        <dl className="sim-readings">
          {metrics.map((m) => (
            <div key={m.key}>
              <dt>{m.label}</dt>
              <dd className="num">{formatReading(frame.values[m.key], m) ?? s.quality.unavailable}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="sim-muted">{held.length ? held.map((o) => t.heldOn(o.label, `${o.value} ${o.unit}`, o.correctionId)).join(" ") : t.noneHeld}</p>
    </div>
  );
}

