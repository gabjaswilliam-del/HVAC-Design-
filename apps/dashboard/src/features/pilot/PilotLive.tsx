import { useId } from "react";
import { useStrings } from "../../lib/i18n";
import { formatNumber, formatTime } from "../../lib/format";
import type { SiteBundle } from "../../lib/contracts";
import type { RunDetail } from "../../lib/contracts/simulation";

const READINGS = ["plant:cop", "plant:cooling_demand_kw", "plant:cooling_delivered_kw", "plant:unmet_kw", "plant:power_kw"] as const;

/** The live run's newest simulated readings as figures, with their source beside them, in
 *  AI Pilot's console (three to a row under its own heading level). */
export function LiveReadings({ run, site, timeZone }: { run: RunDetail; site: SiteBundle; timeZone: string }) {
  const s = useStrings();
  const t = s.pilotLive;
  const frame = run.frame;
  const info = (key: string) => site.metrics.find((m) => m.key === key);
  const id = useId();
  return (
    <section className="pilot-readings pilot-readings--compact" aria-labelledby={id}>
      <div className="sim-section__head">
        <h3 id={id} className="pilot__h">
          {frame ? t.readingsAt(formatTime(frame.at, timeZone)) : t.readings}
        </h3>
        <span className="tag-chip tag-chip--notice">{s.simulation.resultsSource(run.runId)}</span>
      </div>
      <dl className="pilot-readings__grid">
        {READINGS.map((key) => {
          const m = info(key);
          const r = frame?.kpis[key];
          return (
            <div key={key} data-reading={key}>
              <dt>{t.names[key]}</dt>
              <dd className="num">
                {r && r.value !== null ? formatNumber(r.value, m?.decimals ?? 1) : "–"}
                {m?.unit && <span className="pilot-readings__unit"> {m.unit}</span>}
              </dd>
            </div>
          );
        })}
        <div data-reading="energy">
          <dt>{t.energy}</dt>
          <dd className="num">
            {formatNumber(run.stats.energyKwh, 0)}
            <span className="pilot-readings__unit"> kWh</span>
          </dd>
        </div>
      </dl>
    </section>
  );
}
