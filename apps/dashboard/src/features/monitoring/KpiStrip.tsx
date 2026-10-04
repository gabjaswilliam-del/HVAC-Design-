import type { ReactNode } from "react";
import { Clock } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { formatNumber } from "../../lib/format";
import type { Issue, Reading, SiteBundle, Snapshot } from "../../lib/contracts";
import { ISSUES_KPI, KPI_KEYS } from "./kpiDefinitions";

/**
 * Plant indicators as reported by the backend; nothing is recomputed here. Each card
 * is a button that opens its details in the monitoring side panel.
 */
export function KpiStrip({
  site,
  snapshot,
  issues,
  activeKey,
  onOpen,
}: {
  site: SiteBundle;
  snapshot?: Snapshot;
  issues?: Issue[];
  activeKey: string | null;
  onOpen: (key: string) => void;
}) {
  const s = useStrings();
  const reading = (key: string): Reading | undefined => snapshot?.kpis[key] ?? snapshot?.values[key];
  const unmet = reading("plant:unmet_kw");
  const open = issues?.filter((i) => i.status !== "resolved") ?? [];
  const card = (key: string, label: string, body: ReactNode, extraClass = "") => (
    <button
      key={key}
      type="button"
      className={`kpi${extraClass}`}
      data-kpi={key}
      aria-pressed={activeKey === key}
      aria-controls={activeKey === key ? "kpi-panel" : undefined}
      onClick={() => onOpen(key)}
    >
      <span className="kpi__label">{label}</span>
      {body}
      <span className="visually-hidden">{s.kpiPanel.showDetails}</span>
    </button>
  );

  return (
    <section className="kpi-strip" aria-label={s.monitoring.kpis}>
      {KPI_KEYS.map((key) => {
        const info = site.metrics.find((m) => m.key === key)!;
        const r = reading(key);
        const missing = !r || r.value === null;
        return card(
          key,
          info.label,
          <>
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
          </>,
          ` kpi--${r?.quality ?? "unavailable"}`,
        );
      })}
      {card(
        ISSUES_KPI,
        s.monitoring.activeIssues,
        <span className="kpi__value num">{issues ? open.length : " "}</span>,
        open.some((i) => i.severity === "critical") ? " kpi--alert" : "",
      )}
    </section>
  );
}
