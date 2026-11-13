/** The reviewed draft in the Overview's own viewport, labelled as a draft that is not commissioned. */
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { Topology } from "../../lib/contracts";
import { demoScene } from "../../fixtures/demoPlant";
import { useStrings } from "../../lib/i18n";
import { PlantViewport } from "../monitoring/scene/PlantViewport";
import type { Evidence, Selection } from "./cadSession";
import { previewReadings } from "./Drawing2D";
import { Inspector } from "./Inspector";

export function DraftPreview({ topology, onBack, onDeviceEvidence }: { topology: Topology; onBack: () => void; onDeviceEvidence: (id: string, value: Evidence) => void }) {
  const copy = useStrings().cad;
  const [selection, setSelection] = useState<Selection>(null);
  const selectedDevice = selection?.kind === "device" ? topology.devices.find((item) => item.id === selection.id) : undefined;
  return (
    <section className="cad-preview" aria-labelledby="cad-preview-title">
      <header className="cad-preview__head">
        <div>
          <span className="tag-chip tag-chip--notice">{copy.draftPreview}</span>
          <h2 id="cad-preview-title">{copy.previewTitle}</h2>
        </div>
        <button type="button" className="button button--small" onClick={onBack}><ArrowLeft size={15} aria-hidden="true" /> {copy.backToReview}</button>
      </header>
      <div className="cad-preview__stage">
        <PlantViewport
          topology={{ ...topology, devices: topology.devices.map((device) => ({ ...device, label: copy.equipmentName(device.id, device.label) })) }}
          layout={demoScene}
          readings={previewReadings}
          metrics={[]}
          issues={[]}
          selectedId={selectedDevice?.id ?? null}
          onSelect={(id) => setSelection({ kind: "device", id })}
          onOpenIssue={() => undefined}
          float={Boolean(selection)}
          onDismiss={() => setSelection(null)}
          note={{ tag: copy.draftPreview, text: copy.notCommissioned }}
          designPreview
        />
        {selectedDevice && (
          <aside className="cad-inspector cad-inspector--preview" aria-label={copy.inspectorLabel}>
            <Inspector device={selectedDevice} topology={topology} showDirectEvidence onClose={() => setSelection(null)} onEvidence={(value) => onDeviceEvidence(selectedDevice.id, value)} />
          </aside>
        )}
      </div>
    </section>
  );
}
