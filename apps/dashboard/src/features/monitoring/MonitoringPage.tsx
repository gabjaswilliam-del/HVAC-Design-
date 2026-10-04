import { PageHeading } from "../../components/PageHeading";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Info } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { formatAgeMinutes, formatTime } from "../../lib/format";
import { Notice } from "../../components/Notice";
import { useRestoreFocus } from "../../components/useRestoreFocus";
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
  const restoreFocus = useRestoreFocus();

  // URL <-> state. This page is the only writer of `equipment`, `kpi` and `locate`, and
  // reacts only to values it did not write itself (deep links, assistant links), so
  // two updates in one tick cannot overwrite each other with a stale copy.
  const pEquipment = params.get("equipment");
  const pLocate = params.get("locate");
  const pKpi = params.get("kpi");
  const written = useRef({ equipment: null as string | null, kpi: null as string | null });
  useEffect(() => {
    if (!pEquipment || pEquipment === written.current.equipment) return;
    written.current.equipment = pEquipment;
    setKpiKey(null);
    operating.select(pEquipment);
  }, [pEquipment]);
  useEffect(() => {
    if (pEquipment && pLocate) setLocate({ id: pEquipment, nonce: Date.now() });
  }, [pEquipment, pLocate]);
  useEffect(() => {
    if (!isKpiKey(pKpi) || pKpi === written.current.kpi) return;
    written.current.kpi = pKpi;
    setKpiKey(pKpi);
    operating.select(null);
  }, [pKpi]);
  useEffect(() => {
    written.current = { equipment: selectedId, kpi: kpiKey };
    const next = new URLSearchParams(params);
    if (selectedId) next.set("equipment", selectedId);
    else next.delete("equipment");
    if (kpiKey) next.set("kpi", kpiKey);
    else next.delete("kpi");
    next.delete("locate");
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [selectedId, kpiKey, pLocate]); // params are read, not tracked

  // While an indicator is open, point out its equipment on the plant. Only clears
  // highlights this page set, so highlights from the assistant survive.
  const highlightSource = site.data && kpiKey ? kpiEquipment(kpiKey, site.data, issues.data?.issues ?? []).join(",") : "";
  const ownHighlight = useRef("");
  useEffect(() => {
    if (highlightSource === ownHighlight.current) return;
    ownHighlight.current = highlightSource;
    operating.highlight(highlightSource ? highlightSource.split(",") : []);
  }, [highlightSource]);
  useEffect(() => () => void (ownHighlight.current && operating.highlight([])), []);

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
    if (kpiKey) restoreFocus(`[data-kpi="${kpiKey}"]`);
    setKpiKey(null);
  }, [kpiKey, restoreFocus]);
  const close = useCallback(() => {
    if (selectedId) restoreFocus(`[data-equipment-id="${selectedId}"], [data-select-id="${selectedId}"]`);
    operating.select(null);
    setFocusInspector(false);
  }, [selectedId, restoreFocus]);
  const locateOnPlant = useCallback((id: string) => {
    setView("schematic");
    setLocate({ id, nonce: Date.now() });
  }, []);

  if (site.error && !site.data) {
    return (
      <div className="monitoring">
        <PageHeading>{m.heading}</PageHeading>
        <Notice tone="critical" action={{ label: m.retry, onClick: site.retry }}>
          {m.siteFailed} {site.error.message}
        </Notice>
      </div>
    );
  }
  if (!site.data) {
    return (
      <div className="monitoring">
        <PageHeading>{m.heading}</PageHeading>
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
          <PageHeading>{m.heading}</PageHeading>
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
