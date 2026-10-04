import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Info } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { formatAgeMinutes, formatTime } from "../../lib/format";
import { Notice } from "../../components/Notice";
import { operating, useOperating } from "../../app/operatingContext";
import { PlaybackBar } from "../../app/PlaybackBar";
import { useIssues, useSite, useSnapshot } from "../../app/site";
import { EquipmentInspector } from "../equipment";
import { CoolingForecastSummary } from "../prediction";
import { EquipmentList } from "./EquipmentList";
import { KpiDetailsPanel } from "./KpiDetailsPanel";
import { isKpiKey, kpiEquipment } from "./kpiDefinitions";
import { KpiStrip } from "./KpiStrip";
import { RecentIssues } from "./RecentIssues";
import { sceneMatchesTopology } from "./scene/PlantScene";
import { PlantViewport } from "./scene/PlantViewport";
import { SceneLegend } from "./SceneLegend";
import "./monitoring.css";

const NARROW = "(max-width: 760px)";

export function MonitoringPage() {
  const s = useStrings();
  const m = s.monitoring;
  const site = useSite();
  const snapshot = useSnapshot();
  const issues = useIssues();
  const selectedId = useOperating((x) => x.selectedId);
  const highlightIds = useOperating((x) => x.highlightIds);
  const [view, setView] = useState<"schematic" | "list">(() =>
    typeof matchMedia !== "undefined" && matchMedia(NARROW).matches ? "list" : "schematic",
  );
  const [locate, setLocate] = useState<{ id: string; nonce: number } | null>(null);
  const [focusInspector, setFocusInspector] = useState(false);
  const [params, setParams] = useSearchParams();
  // One side panel at a time: indicator details or the equipment inspector.
  const [kpiKey, setKpiKey] = useState<string | null>(() => {
    const k = params.get("kpi");
    return isKpiKey(k) ? k : null;
  });
  const [focusKpi, setFocusKpi] = useState(false);

  // Deep link: ?equipment=<id> selects on arrival; selection keeps the URL in step.
  useEffect(() => {
    const id = params.get("equipment");
    if (id) operating.select(id);
    if (id && params.get("locate")) {
      setLocate({ id, nonce: Date.now() });
      const next = new URLSearchParams(params);
      next.delete("locate");
      setParams(next, { replace: true });
    }
  }, []); // read once on arrival
  useEffect(() => {
    if ((params.get("equipment") ?? null) === selectedId) return;
    const next = new URLSearchParams(params);
    if (selectedId) next.set("equipment", selectedId);
    else next.delete("equipment");
    setParams(next, { replace: true });
  }, [selectedId]); // params are read, not tracked
  useEffect(() => {
    if ((params.get("kpi") ?? null) === kpiKey) return;
    const next = new URLSearchParams(params);
    if (kpiKey) next.set("kpi", kpiKey);
    else next.delete("kpi");
    setParams(next, { replace: true });
  }, [kpiKey]); // params are read, not tracked

  // While an indicator is open, point out its equipment on the plant.
  const highlightSource = site.data && kpiKey ? kpiEquipment(kpiKey, site.data, issues.data?.issues ?? []).join(",") : "";
  useEffect(() => {
    operating.highlight(highlightSource ? highlightSource.split(",") : []);
  }, [highlightSource]);
  useEffect(() => () => operating.highlight([]), []);

  const select = useCallback((id: string) => {
    setKpiKey(null);
    operating.select(id);
    setFocusInspector(true);
  }, []);
  const openKpi = useCallback((key: string) => {
    operating.select(null);
    setKpiKey((current) => (current === key ? null : key));
    setFocusKpi(true);
  }, []);
  const closeKpi = useCallback(() => {
    const key = kpiKey;
    setKpiKey(null);
    if (key) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-kpi="${key}"]`)?.focus());
  }, [kpiKey]);
  const close = useCallback(() => {
    const id = selectedId;
    operating.select(null);
    setFocusInspector(false);
    if (id) {
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement | SVGElement>(`[data-equipment-id="${id}"], [data-select-id="${id}"]`)?.focus(),
      );
    }
  }, [selectedId]);
  const locateOnPlant = useCallback((id: string) => {
    setView("schematic");
    setLocate({ id, nonce: Date.now() });
  }, []);

  if (site.error && !site.data) {
    return (
      <div className="monitoring">
        <h1 tabIndex={-1}>{m.heading}</h1>
        <Notice tone="critical" action={{ label: m.retry, onClick: site.retry }}>
          {m.siteFailed} {site.error.message}
        </Notice>
      </div>
    );
  }
  if (!site.data) {
    return (
      <div className="monitoring">
        <h1 tabIndex={-1}>{m.heading}</h1>
        <div className="skeleton" style={{ height: 480 }} aria-busy="true" />
      </div>
    );
  }

  const bundle = site.data;
  const tz = bundle.site.timezone;
  const tzLabel = bundle.site.timezoneLabel;
  const snap = snapshot.data;
  const matches = sceneMatchesTopology(bundle.scene, bundle.topology);
  const age = formatAgeMinutes(snap?.latestSampleAt ?? null, Date.parse(snapshot.at));
  const issueList = issues.data?.issues ?? [];
  const viewSwitch = (
    <div className="segmented" role="group" aria-label={m.view}>
      <button type="button" aria-pressed={view === "schematic"} disabled={!matches} onClick={() => setView("schematic")}>
        {m.viewSchematic}
      </button>
      <button type="button" aria-pressed={view === "list" || !matches} onClick={() => setView("list")}>
        {m.viewList}
      </button>
    </div>
  );
  const readings = snap ?? { equipment: {}, values: {} };

  return (
    <div className="monitoring">
      <div className="monitoring__top">
        <div className="monitoring__head">
          <h1 tabIndex={-1}>{m.heading}</h1>
          <p className="monitoring__notice">
            <Info size={16} aria-hidden="true" />
            {m.topologyNotice}
          </p>
        </div>

        <KpiStrip site={bundle} snapshot={snap} issues={issues.data?.issues} activeKey={kpiKey} onOpen={openKpi} />

        <p className="monitoring__status num" aria-live="polite">
          {snap && (
            <>
              {m.readingsAt} {formatTime(snap.at, tz)} {tzLabel}, {m.newestSample}{" "}
              {snap.latestSampleAt ? formatTime(snap.latestSampleAt, tz) : s.quality.unavailable}
              {age !== null && <> ({m.minutesOld(age)})</>}
            </>
          )}
        </p>
        {snap?.connection === "disconnected" && (
          <Notice tone="critical">{m.disconnected(`${formatTime(snap.latestSampleAt!, tz)} ${tzLabel}`)}</Notice>
        )}
        {snapshot.error && (
          <Notice tone="warning" action={{ label: m.retry, onClick: snapshot.retry }}>
            {m.loadFailed} {snapshot.error.message}
          </Notice>
        )}

        <div className={`monitoring__work${selectedId || kpiKey ? " monitoring__work--inspecting" : ""}`}>
          <div className="monitoring__stage">
            {!matches && (
              <Notice tone="warning">
                <strong>{m.mismatchTitle}.</strong>{" "}
                {m.mismatchBody(bundle.scene.configRevision, bundle.topology.configRevision)}
              </Notice>
            )}
            {matches && view === "schematic" ? (
              <PlantViewport
                topology={bundle.topology}
                layout={bundle.scene}
                readings={readings}
                selectedId={selectedId}
                highlightIds={highlightIds}
                onSelect={select}
                locate={locate}
                leading={viewSwitch}
              />
            ) : (
              <>
                <div className="monitoring__stage-bar">{viewSwitch}</div>
                <EquipmentList site={bundle} snapshot={snap} selectedId={selectedId} onSelect={select} />
              </>
            )}
          </div>
          {kpiKey ? (
            <div className="monitoring__inspector">
              <KpiDetailsPanel
                kpiKey={kpiKey}
                site={bundle}
                snapshot={snap}
                issues={issues}
                onClose={closeKpi}
                onLocate={locateOnPlant}
                onInspect={select}
                focusOnOpen={focusKpi}
              />
            </div>
          ) : selectedId && (
            <div className="monitoring__inspector">
              <EquipmentInspector
                equipmentId={selectedId}
                site={bundle}
                snapshot={snap}
                issues={issueList}
                onSelect={select}
                onLocate={matches ? locateOnPlant : undefined}
                onClose={close}
                focusOnOpen={focusInspector}
              />
            </div>
          )}
        </div>

        <PlaybackBar timeZone={tz} timezoneLabel={tzLabel} />
      </div>

      <div className="monitoring__below">
        <CoolingForecastSummary site={bundle} />
        <RecentIssues site={bundle} issues={issues} at={snapshot.at} onSelect={select} />
      </div>
      <SceneLegend />
    </div>
  );
}
