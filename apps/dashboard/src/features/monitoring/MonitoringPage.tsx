import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Presentation, Waypoints, X } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { openIssues } from "../../lib/issues";
import type { Issue } from "../../lib/contracts";
import { Notice } from "../../components/Notice";
import { RadioGroup } from "../../components/RadioGroup";
import { getOperating, operating, useOperating, type OverviewView } from "../../app/operatingContext";
import { useIssues, usePlantSnapshot, useSite } from "../../app/site";
import { useWorkspaceLayout } from "../../app/useWorkspaceLayout";
import { isKpiKey, kpiEquipment } from "./kpiDefinitions";
import { sceneMatchesTopology } from "./scene/PlantScene";
import { PlantViewport } from "./scene/PlantViewport";
import { AiDisplay } from "../display";
import "./monitoring.css";

/**
 * Overview: the plant on its display, edge to edge. Three things float over it, each
 * in an empty corner: the view switch, the drawing controls and the disclosure. The
 * summary readings and the attention slot live in the top bar; Details open in the
 * workspace.
 */
export function MonitoringPage() {
  const s = useStrings();
  const m = s.monitoring;
  const site = useSite();
  // The plant runs only while the simulation plays; paused, it is shown at rest.
  const snapshot = usePlantSnapshot();
  const issues = useIssues();
  const selectedId = useOperating((x) => x.selectedId);
  const kpiKey = useOperating((x) => x.kpiKey);
  const highlightIds = useOperating((x) => x.highlightIds);
  const locateRequest = useOperating((x) => x.locateRequest);
  const view = useOperating((x) => x.overviewView);
  const layout = useWorkspaceLayout();
  const [locate, setLocate] = useState<{ id: string; nonce: number } | null>(null);
  const [params, setParams] = useSearchParams();
  const mountedAt = useRef(Date.now());
  const navigate = useNavigate();

  // URL <-> state. This page is the only writer of `equipment`, `kpi`, `locate` and
  // `view`, and reacts only to values it did not write itself (deep links, assistant
  // links), so two updates in one tick cannot overwrite each other with a stale copy.
  const pEquipment = params.get("equipment");
  const pLocate = params.get("locate");
  const pKpi = params.get("kpi");
  const pView = params.get("view");
  const written = useRef({ equipment: null as string | null, kpi: null as string | null });
  useEffect(() => {
    if (!pEquipment || pEquipment === written.current.equipment) return;
    written.current.equipment = pEquipment;
    operating.select(pEquipment);
  }, [pEquipment]);
  useEffect(() => {
    if (!pEquipment || !pLocate) return;
    operating.setOverviewView("schematic");
    setLocate({ id: pEquipment, nonce: Date.now() });
  }, [pEquipment, pLocate]);
  useEffect(() => {
    if (!isKpiKey(pKpi) || pKpi === written.current.kpi) return;
    written.current.kpi = pKpi;
    operating.openKpi(pKpi);
  }, [pKpi]);
  // `?view=display` opens the AI display. Read when the page opens only: the address is
  // written below, and a late copy must not flip the view.
  useEffect(() => {
    if (pView === "display") operating.setOverviewView("display");
  }, []);
  useEffect(() => {
    // Read the store now, not this render's values: a deep link applied by the effects
    // above is already in the store, and must not be written away for one render.
    const { selectedId: equipment, kpiKey: kpi, overviewView } = getOperating();
    const viewParam = overviewView === "display" ? "display" : null;
    written.current = { equipment, kpi };
    const next = new URLSearchParams(params);
    if (equipment) next.set("equipment", equipment);
    else next.delete("equipment");
    // An unknown indicator stays in the address until dismissed, so its notice can say so.
    if (kpi) next.set("kpi", kpi);
    else if (isKpiKey(next.get("kpi"))) next.delete("kpi");
    if (viewParam) next.set("view", viewParam);
    else next.delete("view");
    next.delete("locate");
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [selectedId, kpiKey, view, pLocate]); // params are read, not tracked

  // Locate requests from Details, the top bar and shortcuts (made while this page was open).
  useEffect(() => {
    if (!locateRequest || locateRequest.nonce < mountedAt.current) return;
    operating.setOverviewView("schematic");
    setLocate(locateRequest);
  }, [locateRequest?.nonce]);

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

  const select = useCallback((id: string) => operating.select(id, true), []);
  const openIssue = useCallback((issue: Issue) => operating.select(issue.equipmentIds[0], true), []);
  // Below 1440 px a floating panel is dismissed by clicking empty drawing.
  const dismiss = useCallback(() => {
    const o = getOperating();
    if (o.selectedId || o.kpiKey) operating.closeDetails();
    else operating.closeWorkspace();
  }, []);
  const dropUnknownKpi = () => {
    const next = new URLSearchParams(params);
    next.delete("kpi");
    setParams(next, { replace: true });
  };

  if (site.error && !site.data) {
    return (
      <section className="stage stage--message" aria-label={m.stage}>
        <Notice tone="critical" action={{ label: m.retry, onClick: site.retry }}>
          {m.siteFailed} {site.error.message}
        </Notice>
      </section>
    );
  }
  if (!site.data) {
    return <section className="stage" aria-label={m.stage} aria-busy="true" />;
  }

  const bundle = site.data;
  const snap = snapshot.data;
  const matches = sceneMatchesTopology(bundle.scene, bundle.topology);
  // A scene drawn for another configuration is not drawn: the AI display is shown instead.
  const shown: OverviewView = matches ? view : "display";
  const readings = snap ?? { equipment: {}, values: {} };
  const unknownKpi = pKpi && !isKpiKey(pKpi) ? pKpi : null;

  return (
    <section className={`stage stage--${shown}`} aria-label={m.stage}>
      {shown === "schematic" ? (
        <PlantViewport
          topology={bundle.topology}
          layout={bundle.scene}
          readings={readings}
          metrics={bundle.metrics}
          issues={openIssues(issues.data?.issues)}
          selectedId={selectedId}
          highlightIds={highlightIds}
          onSelect={select}
          onOpenIssue={openIssue}
          locate={locate}
          float={layout === "float"}
          onDismiss={layout === "float" ? dismiss : undefined}
        />
      ) : (
        <AiDisplay timeZone={bundle.site.timezone} />
      )}

      <RadioGroup<OverviewView>
        className="viewswitch"
        label={m.view}
        value={shown}
        onChange={(v) => operating.setOverviewView(v)}
        options={[
          { value: "schematic", label: <Waypoints size={16} aria-hidden="true" />, name: m.viewSchematic, title: `${m.viewSchematic} (L)`, disabled: !matches },
          { value: "display", label: <Presentation size={16} aria-hidden="true" />, name: m.viewDisplay, title: `${m.viewDisplay} (L)` },
        ]}
      />

      {(unknownKpi || snapshot.error || !matches) && (
        <div className="stage-notices">
          {!matches && (
            <Notice tone="warning" action={{ label: m.openRecords, onClick: () => navigate("/engineering") }}>
              <strong>{m.mismatchTitle}.</strong> {m.mismatchBody(bundle.scene.configRevision, bundle.topology.configRevision)}
            </Notice>
          )}
          {snapshot.error && (
            <Notice tone="warning" action={{ label: m.retry, onClick: snapshot.retry }}>
              {m.loadFailed} {snapshot.error.message}
            </Notice>
          )}
          {unknownKpi && (
            <div className="notice notice--info" role="status">
              <span className="notice__body">{m.unknownKpi(unknownKpi)}</span>
              <button type="button" className="icon-button" aria-label={m.dismiss} title={m.dismiss} onClick={dropUnknownKpi}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
