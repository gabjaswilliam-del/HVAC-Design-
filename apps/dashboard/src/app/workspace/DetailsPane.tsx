import { ChevronDown, Info } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { StateLabel } from "../../components/StateLabel";
import { EquipmentInspector } from "../../features/equipment";
import { KpiDetailsPanel, sceneMatchesTopology } from "../../features/monitoring";
import { ISSUES_KPI } from "../../features/monitoring/kpiDefinitions";
import { operating, useOperating } from "../operatingContext";
import { useIssues, usePlantSnapshot, useSite } from "../site";
import { useShowOnPlant } from "../useShowOnPlant";

/**
 * Details in the workspace: the equipment inspector or a plant indicator, whichever
 * is open. "Locate" centres the item on the Overview's drawing from any screen.
 */
export function DetailsPane({ restoreFocus }: { restoreFocus: (...selectors: string[]) => void }) {
  const site = useSite();
  const snapshot = usePlantSnapshot();
  const issues = useIssues();
  const selectedId = useOperating((x) => x.selectedId);
  const kpiKey = useOperating((x) => x.kpiKey);
  const detailsFocus = useOperating((x) => x.detailsFocus);
  const showOnPlant = useShowOnPlant();
  if (!site.data) return null;
  const bundle = site.data;
  const locate = (id: string) => showOnPlant(id, false);

  if (kpiKey) {
    return (
      <KpiDetailsPanel
        kpiKey={kpiKey}
        site={bundle}
        snapshot={snapshot.data}
        issues={issues}
        onClose={() => {
          // An indicator from More readings returns focus to its button once the tray is gone.
          restoreFocus(`[data-kpi="${kpiKey}"]`, ".more");
          operating.closeKpi();
        }}
        onLocate={locate}
        onInspect={(id) => operating.select(id, true)}
        focusOnOpen={detailsFocus}
      />
    );
  }
  if (!selectedId) return null;
  return (
    <EquipmentInspector
      equipmentId={selectedId}
      site={bundle}
      snapshot={snapshot.data}
      issues={issues.data?.issues ?? []}
      onSelect={(id) => operating.select(id, true)}
      // Locate needs a drawing that matches the configuration.
      onLocate={sceneMatchesTopology(bundle.scene, bundle.topology) ? locate : undefined}
      onClose={() => {
        restoreFocus(`[data-equipment-id="${selectedId}"], [data-select-id="${selectedId}"]`);
        operating.select(null);
      }}
      focusOnOpen={detailsFocus}
    />
  );
}

/** Details folded to one line while the conversation has the space; restores them. */
export function DetailsStrip() {
  const s = useStrings();
  const site = useSite();
  const snapshot = usePlantSnapshot();
  const selectedId = useOperating((x) => x.selectedId);
  const kpiKey = useOperating((x) => x.kpiKey);
  const device = site.data?.topology.devices.find((d) => d.id === selectedId);
  const status = selectedId ? snapshot.data?.equipment[selectedId] : undefined;
  const title = device
    ? device.label
    : kpiKey === ISSUES_KPI
      ? s.kpiPanel.issues.heading
      : site.data?.metrics.find((m) => m.key === kpiKey)?.label ?? s.kpiPanel.label;

  return (
    <button type="button" className="det-strip" aria-expanded={false} onClick={() => operating.setDetailsCollapsed(false)}>
      {status ? <StateLabel state={status.state} stale={status.stale} /> : <Info size={16} aria-hidden="true" />}
      <span className="det-strip__title">{title}</span>
      <span className="det-strip__more">
        {s.workspace.showDetails}
        <ChevronDown size={15} aria-hidden="true" />
      </span>
    </button>
  );
}
