import { Clock } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { formatNumber } from "../../lib/format";
import type { Issue, Reading, SiteBundle, Snapshot } from "../../lib/contracts";

const KPIS = [
  "plant:cooling_demand_kw",
  "plant:cooling_delivered_kw",
  "plant:power_kw",
  "plant:cop",
  "chw_supply:temp_c",
  "plant:chw_delta_t_c",
  "plant:approach_c",
  "weather:wet_bulb_c",
];

/** Plant indicators as reported by the backend; nothing is recomputed here. */
export function KpiStrip({ site, snapshot, issues }: { site: SiteBundle; snapshot?: Snapshot; issues?: Issue[] }) {
  const s = useStrings();
  const reading = (key: string): Reading | undefined => snapshot?.kpis[key] ?? snapshot?.values[key];
  const unmet = reading("plant:unmet_kw");
  const open = issues?.filter((i) => i.status !== "resolved") ?? [];

  return (
    <section className="kpi-strip" aria-label={s.monitoring.kpis}>
      {KPIS.map((key) => {
        const info = site.metrics.find((m) => m.key === key)!;
        const r = reading(key);
        const missing = !r || r.value === null;
        return (
          <div key={key} className={`kpi kpi--${r?.quality ?? "unavailable"}`} data-kpi={key}>
            <span className="kpi__label">{info.label}</span>
            {missing ? (
              <span className="kpi__missing">{snapshot ? s.quality.unavailable : " "}</span>
            ) : (
              <span className="kpi__value num">
                {formatNumber(r.value!, info.decimals)}
                {info.unit && <span className="kpi__unit"> {info.unit}</span>}
                {r.quality === "stale" && (
                  <span className="kpi__stale">
                    <Clock size={13} aria-hidden="true" /> {s.quality.stale}
                  </span>
                )}
              </span>
            )}
            {key === "plant:cooling_delivered_kw" && unmet?.value ? (
              <span className="kpi__alert num">
                {formatNumber(unmet.value, 0)} kWt {s.monitoring.unmet}
              </span>
            ) : null}
          </div>
        );
      })}
      <div className={`kpi${open.some((i) => i.severity === "critical") ? " kpi--alert" : ""}`} data-kpi="issues">
        <span className="kpi__label">{s.monitoring.activeIssues}</span>
        <span className="kpi__value num">{issues ? open.length : " "}</span>
      </div>
    </section>
  );
}
