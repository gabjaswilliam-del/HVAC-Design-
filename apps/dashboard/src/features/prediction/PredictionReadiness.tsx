import { CircleCheck, CircleSlash } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { Notice } from "../../components/Notice";
import { useForecastCapabilities } from "./ForecastDataController";

/**
 * Which forecasting modes can run and why the others cannot. Reusable by the
 * installation screen. Reports what the backend advertises; nothing is assumed.
 */
export function PredictionReadiness() {
  const s = useStrings();
  const t = s.prediction;
  const caps = useForecastCapabilities();
  return (
    <section className="panel" aria-labelledby="readiness-heading">
      <div className="panel__head">
        <h2 id="readiness-heading">{t.readiness}</h2>
      </div>
      <div className="panel__body">
        {caps.error && !caps.data ? (
          <Notice tone="warning" action={{ label: s.monitoring.retry, onClick: caps.retry }}>
            {caps.error.message}
          </Notice>
        ) : !caps.data ? (
          <div className="skeleton" style={{ height: 120 }} />
        ) : (
          <>
            <ul className="readiness">
              {caps.data.modes.map((m) => (
                <li key={m.mode} data-mode={m.mode} className={m.available ? "is-available" : undefined}>
                  {m.available ? <CircleCheck size={16} aria-hidden="true" /> : <CircleSlash size={16} aria-hidden="true" />}
                  <span className="readiness__mode">{t.modeLabels[m.mode]}</span>
                  <span className="readiness__state">{m.available ? t.available : t.notAvailable}</span>
                  {m.reason && <span className="readiness__reason">{m.reason}</span>}
                  {m.artifactId && <span className="readiness__reason">{m.artifactId}</span>}
                </li>
              ))}
            </ul>
            <p className="inspector__muted">{t.historyDays(caps.data.historyDaysAvailable, caps.data.minHistoryDays)}</p>
          </>
        )}
      </div>
    </section>
  );
}
