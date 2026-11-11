import { Activity, ArrowRight, Bot, History, SlidersHorizontal } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { targetPath } from "../../app/navigation";
import { showInPilot } from "../../app/openTarget";
import { operating } from "../../app/operatingContext";
import { useStrings } from "../../lib/i18n";
import { liveRunOf, simulationSession, useSimulation } from "../simulation";
import "./engineering.css";

export function EngineeringPage() {
  const s = useStrings();
  const e = s.engineeringSimulation;
  const { runs, run } = useSimulation();
  const active = liveRunOf(runs);
  const navigate = useNavigate();
  const openPilot = () => {
    if (active) {
      showInPilot({ type: "pilot", runId: active.runId });
      simulationSession.compose(false);
      navigate(targetPath({ type: "simulation", runId: active.runId }));
      return;
    }
    simulationSession.compose(Boolean(run));
    operating.openWorkspace("pilot");
  };
  const steps = [
    { icon: SlidersHorizontal, title: e.setup, description: e.setupHelp },
    { icon: Activity, title: e.monitor, description: e.monitorHelp },
    { icon: History, title: e.review, description: e.reviewHelp },
  ];
  return (
    <div className="page engineering-simulation">
      <section id="hub-simulation" className="engineering-simulation__intro" aria-labelledby="engineering-simulation-title">
        <span className="engineering-simulation__icon"><Bot size={24} aria-hidden="true" /></span>
        <div className="sim__title-row">
          <h2 className="page__title" id="engineering-simulation-title">{e.title}</h2>
          <span className="tag-chip tag-chip--notice">{s.pilot.scope}</span>
          <span className="tag-chip tag-chip--demo">{s.simulation.mock}</span>
        </div>
        <p className="page__sub">{e.lead}</p>
        <div className="engineering-simulation__actions">
          <button type="button" className="button button--primary" onClick={openPilot}>
            <Bot size={16} aria-hidden="true" /> {active ? e.resumeView : e.configure}
          </button>
          <Link className="button" to={targetPath({ type: "simulation" })}>
            <History size={16} aria-hidden="true" /> {e.openHistory}
          </Link>
        </div>
      </section>
      <section className="engineering-simulation__guide" aria-labelledby="engineering-guide-title">
        <h2 id="engineering-guide-title">{e.guide}</h2>
        <ol className="engineering-simulation__steps">
          {steps.map(({ icon: Icon, title, description }, index) => (
            <li key={title}>
              <span className="engineering-simulation__step-label">
                <Icon size={18} aria-hidden="true" /> <span className="num" aria-hidden="true">0{index + 1}</span>
              </span>
              <h3>{title}</h3>
              <p>{description}</p>
            </li>
          ))}
        </ol>
      </section>
      <p className="engineering-simulation__note">
        {runs.length ? s.history.runs(runs.length) : s.history.empty}
        {runs.length > 0 && (
          <Link className="link" to={targetPath({ type: "simulation", runId: runs[0].runId })}>
            {e.latest(runs[0].runId)} <ArrowRight size={14} aria-hidden="true" />
          </Link>
        )}
      </p>
    </div>
  );
}
