import { Link } from "react-router";
import { useStrings } from "../../lib/i18n";

/**
 * The pilot in the workspace. Nothing runs yet: no simulation service exists in this
 * build, so the panel says so and describes what the pilot will show. The pilot works
 * on simulation runs only; there is no physical-equipment control anywhere.
 */
export function PilotPanel({ hidden = false }: { hidden?: boolean }) {
  const s = useStrings();
  const p = s.pilot;
  return (
    <aside id="pilot-panel" className="pilot-panel" aria-label={p.label} data-escape-ignore hidden={hidden}>
      <p className="pilot-panel__scope">
        <span className="tag-chip tag-chip--notice">{p.scope}</span>
        <span>{p.scopeNote}</span>
      </p>
      <div className="pilot-panel__state">
        <h3>
          {p.unavailable}
          <span className="tag-chip tag-chip--planned">{s.nav.planned}</span>
        </h3>
        <p>{p.body}</p>
        <p className="pilot-panel__muted">{p.needs}</p>
        <p className="pilot-panel__links">
          <Link className="link" to="/simulation">
            {p.openSimulation}
          </Link>
          <Link className="link" to="/pilot">
            {p.openPage}
          </Link>
        </p>
      </div>
      <div className="pilot-panel__preview">
        <h3>{p.willShow}</h3>
        <ol>
          {p.stages.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ol>
        <p className="pilot-panel__lifecycle">
          {p.lifecycle.map((x) => (
            <span key={x} className="chip">
              {x}
            </span>
          ))}
        </p>
      </div>
    </aside>
  );
}
