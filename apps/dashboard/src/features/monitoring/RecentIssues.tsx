import { useStrings } from "../../lib/i18n";
import { formatTime } from "../../lib/format";
import type { Issue, SiteBundle } from "../../lib/contracts";
import type { Resource } from "../../lib/api/useResource";
import { Notice } from "../../components/Notice";
import type { IssueList } from "../../lib/contracts";

const ORDER = { critical: 0, warning: 1, info: 2 };

/** Issues known at the playback time, most severe first; equipment links select it. */
export function RecentIssues({
  site,
  issues,
  at,
  onSelect,
}: {
  site: SiteBundle;
  issues: Resource<IssueList>;
  at: string;
  onSelect: (id: string) => void;
}) {
  const s = useStrings();
  const tz = site.site.timezone;
  const list = [...(issues.data?.issues ?? [])].sort(
    (a: Issue, b: Issue) =>
      Number(a.status === "resolved") - Number(b.status === "resolved") || ORDER[a.severity] - ORDER[b.severity],
  );

  return (
    <section className="panel issues-panel" aria-labelledby="issues-heading">
      <div className="panel__head">
        <h2 id="issues-heading">{s.issues.heading}</h2>
      </div>
      <div className="panel__body">
        {issues.error && !issues.data ? (
          <Notice tone="warning" action={{ label: s.monitoring.retry, onClick: issues.retry }}>
            {s.issues.loadFailed} {issues.error.message}
          </Notice>
        ) : !issues.data ? (
          <div className="skeleton" style={{ height: 80 }} />
        ) : list.length === 0 ? (
          <p className="issues-panel__empty">{s.issues.none(`${formatTime(at, tz)} ${site.site.timezoneLabel}`)}</p>
        ) : (
          <ul className="issues-panel__list">
            {list.map((i) => (
              <li key={i.id} className={`issue-line issue-line--${i.severity}${i.status === "resolved" ? " is-resolved" : ""}`}>
                <span className="issue-line__severity">
                  {s.issues.severity[i.severity]}, {s.issues.status[i.status].toLowerCase()}, {i.id}
                </span>
                <span className="issue-line__title">{i.title}</span>
                <span className="issues-panel__summary">{i.summary}</span>
                <span className="issues-panel__meta">
                  {s.issues.firstSeen} {formatTime(i.firstSeen, tz)}
                  {i.equipmentIds.map((id) => (
                    <button key={id} type="button" className="text-button" onClick={() => onSelect(id)}>
                      {site.topology.devices.find((d) => d.id === id)?.label ?? id}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
