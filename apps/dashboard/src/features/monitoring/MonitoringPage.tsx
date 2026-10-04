import { Info } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { demoScene, demoTopology, previewReadings } from "../../fixtures/demoPlant";
import { PlantScene } from "./scene/PlantScene";
import { SceneLegend } from "./SceneLegend";
import "./monitoring.css";

// ponytail: Milestone 1 artwork preview. KPI strip, pan/zoom, selection, inspector,
// playback and the forecast summary arrive in Milestone 3.
export function MonitoringPage() {
  const s = useStrings();
  return (
    <div className="monitoring">
      <div className="monitoring__head">
        <h1 tabIndex={-1}>{s.monitoring.heading}</h1>
        <p className="monitoring__notice">
          <Info size={16} aria-hidden="true" />
          {s.monitoring.topologyNotice} {s.monitoring.previewNotice}
        </p>
      </div>
      <div className="monitoring__scene">
        <PlantScene
          topology={demoTopology}
          layout={demoScene}
          readings={previewReadings}
          title={s.monitoring.sceneTitle}
        />
      </div>
      <SceneLegend />
    </div>
  );
}
