import { useStrings } from "../../lib/i18n";
import { formatReading, formatTime } from "../../lib/format";
import type { SiteBundle, Snapshot } from "../../lib/contracts";
import { StateLabel } from "../../components/StateLabel";

/**
 * Accessible list equivalent of the plant schematic; the default view on narrow
 * screens and the fallback when the scene cannot be drawn.
 */
export function EquipmentList({
  site,
  snapshot,
  selectedId,
  onSelect,
}: {
  site: SiteBundle;
  snapshot?: Snapshot;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const s = useStrings();
  const l = s.monitoring.list;
  return (
    <div className="equipment-list">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">{l.equipment}</th>
            <th scope="col" className="equipment-list__type">{l.type}</th>
            <th scope="col">{l.state}</th>
            <th scope="col">{l.readings}</th>
            <th scope="col">{l.updated}</th>
          </tr>
        </thead>
        <tbody>
          {site.topology.devices.map((d) => {
            const status = snapshot?.equipment[d.id];
            const readings = site.metrics
              .filter((m) => m.key.startsWith(`${d.id}:`))
              .slice(0, 2)
              .map((m) => formatReading(snapshot?.values[m.key], m) ?? s.quality.unavailable);
            return (
              <tr key={d.id} className={selectedId === d.id ? "is-selected" : undefined}>
                <th scope="row">
                  <button
                    type="button"
                    className="text-button equipment-list__name"
                    aria-pressed={selectedId === d.id}
                    data-select-id={d.id}
                    onClick={() => onSelect(d.id)}
                  >
                    {d.label}
                  </button>
                </th>
                <td className="equipment-list__type">{s.families[d.family]}</td>
                <td>{status ? <StateLabel state={status.state} stale={status.stale} /> : s.quality.unavailable}</td>
                <td className="num">{readings.join(", ")}</td>
                <td className="num">
                  {status?.sampleTime ? formatTime(status.sampleTime, site.site.timezone) : s.inspector.noSample}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
