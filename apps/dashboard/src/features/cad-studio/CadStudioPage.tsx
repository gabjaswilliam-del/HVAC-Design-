import { useEffect } from "react";
import { useStrings } from "../../lib/i18n";
import { cad, useCadSession } from "./cadSession";
import { DraftPreview } from "./DraftPreview";
import { ExtractionProgress } from "./ExtractionProgress";
import { ConfirmBox, ProjectLibrary } from "./ProjectLibrary";
import { Workbench } from "./Workbench";
import "../monitoring/monitoring.css";
import "./cadStudio.css";

/**
 * CAD Studio: the Project Library when no project is open (or on a phone, when asked for), the
 * prepared sample's extraction replay the first time it opens, the Overview preview, and the
 * workbench. The page only renders the session (cadSession.ts), which outlives it.
 */
export function CadStudioPage() {
  const copy = useStrings().cad;
  const session = useCadSession();
  const { screen, progress, project, discard } = session;
  const steps = copy.extraction.length;

  useEffect(() => {
    void cad.loadLibrary();
  }, []);

  useEffect(() => {
    if (screen !== "extract") return;
    const timer = window.setTimeout(() => cad.advance(steps), progress >= steps ? 250 : 420);
    return () => window.clearTimeout(timer);
  }, [steps, progress, screen]);

  const body = !project || screen === "library"
    ? <ProjectLibrary variant="page" steps={steps} />
    : screen === "extract"
      ? <ExtractionProgress progress={progress} onSkip={() => cad.skip(steps)} />
      : screen === "preview"
        ? <DraftPreview topology={session.topology} onBack={() => cad.show("studio")} onDeviceEvidence={cad.setDeviceEvidence} />
        : <Workbench steps={steps} />;

  return (
    <div className="cad-studio">
      {discard && project && (
        <div className="cad-studio__confirm">
          <ConfirmBox message={copy.discardTitle(project.name)} confirm={copy.discard} onConfirm={() => cad.confirmDiscard(steps)} onCancel={cad.cancelDiscard} />
        </div>
      )}
      {body}
    </div>
  );
}
