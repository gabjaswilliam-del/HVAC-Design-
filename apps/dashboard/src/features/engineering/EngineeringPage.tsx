import { useEffect, useId, useState } from "react";
import { Link, useLocation } from "react-router";
import { Crosshair, Search } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { formatTime } from "../../lib/format";
import { openIssues } from "../../lib/issues";
import type { LinkEnd, SiteBundle } from "../../lib/contracts";
import { Notice } from "../../components/Notice";
import { StateLabel } from "../../components/StateLabel";
import { ISSUES_KPI } from "../monitoring/kpiDefinitions";
import { sceneMatchesTopology } from "../monitoring";
import { operating } from "../../app/operatingContext";
import { useIssues, useSite, useSnapshot } from "../../app/site";
import { useShowOnPlant } from "../../app/useShowOnPlant";
import { useSimulation } from "../simulation";
import { targetPath } from "../../app/navigation";
import "./engineering.css";

/**
 * Engineering: a hub in four flat sections, in the order engineers work. Simulation has
 * its own screen (`/simulation`); its row here says which run is open. CAD is not built
 * in this release; its row says what it needs, and `/cad` opens the hub at that row.
 */
export function EngineeringPage() {
  const s = useStrings();
  const site = useSite();
  const location = useLocation();
  const focus = location.pathname.split("/")[1];

  // `/cad` opens the hub with its row focused.
  useEffect(() => {
    if (focus !== "cad") return;
    const row = document.getElementById(`hub-${focus}`);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "center" });
  }, [focus, site.data === undefined]);

  if (site.error && !site.data) {
    return (
      <div className="page">
        <Notice tone="critical" action={{ label: s.monitoring.retry, onClick: site.retry }}>
          {s.monitoring.siteFailed} {site.error.message}
        </Notice>
      </div>
    );
  }
  if (!site.data) return <div className="page" aria-busy="true" />;
  return <Hub site={site.data} focus={focus} />;
}

function Hub({ site, focus }: { site: SiteBundle; focus: string }) {
  const s = useStrings();
  const e = s.engineering;
  const issues = useIssues();
  const snapshot = useSnapshot();
  const showOnPlant = useShowOnPlant();
  const sim = useSimulation();
  const searchId = useId();
  const [query, setQuery] = useState("");
  const tz = site.site.timezone;
  const open = openIssues(issues.data?.issues);
  const devices = site.topology.devices;
  const q = query.trim().toLowerCase();
  const records = devices.filter((d) => !q || d.label.toLowerCase().includes(q) || d.id.toLowerCase().includes(q));
  const canLocate = sceneMatchesTopology(site.scene, site.topology);

  const links = site.topology.links;
  const evidence = (["confirmed", "drawing", "inferred", "unknown"] as const)
    .map((ev) => ({ ev, n: links.filter((l) => l.evidence === ev).length }))
    .filter((x) => x.n > 0);
  const labelOf = (end: LinkEnd) =>
    "device" in end ? devices.find((d) => d.id === end.device)?.label ?? end.device : site.topology.buses.find((b) => b.id === end.bus)?.label ?? end.bus;
  const review = links.filter((l) => l.evidence === "inferred" || l.evidence === "unknown");
  const anchorOf = (l: (typeof links)[number]) => ("device" in l.from ? l.from.device : "device" in l.to ? l.to.device : null);

  return (
    <div className="page hub">
      <div className="page__head">
        <h2 className="page__title">{e.heading}</h2>
        <p className="page__sub">{e.lead}</p>
      </div>

      <section className="hub__section" aria-labelledby="hub-investigations-title">
        <h2 id="hub-investigations-title">{e.investigations}</h2>
        {open.length ? (
          <ul className="hub__rows">
            {open.map((i) => {
              const first = i.equipmentIds[0];
              const content = (
                <>
                  <span className="hub__row-main">
                    <span className={`sev sev--${i.severity}`}>{s.issues.severity[i.severity]}</span>
                    <span className="hub__row-title">{i.title}</span>
                  </span>
                  <span className="hub__row-meta num">{e.firstSeen(i.id, formatTime(i.firstSeen, tz))}</span>
                </>
              );
              return (
                <li key={i.id}>
                  {first ? (
                    <Link className="hub__row" to={`/equipment/${encodeURIComponent(first)}`}>
                      {content}
                    </Link>
                  ) : (
                    <button type="button" className="hub__row" onClick={() => operating.openKpi(ISSUES_KPI, true)}>
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="hub__empty">{issues.data ? e.noInvestigations : " "}</p>
        )}
      </section>

      <section className="hub__section" aria-labelledby="hub-records-title">
        <div className="hub__section-head">
          <h2 id="hub-records-title">{e.records}</h2>
          <span className="hub__count num" aria-live="polite">
            {e.recordsCount(records.length, devices.length)}
          </span>
        </div>
        <span className="field hub__search">
          <Search size={16} aria-hidden="true" />
          <label htmlFor={searchId} className="visually-hidden">
            {e.search}
          </label>
          <input id={searchId} type="search" placeholder={e.searchPlaceholder} value={query} onChange={(ev) => setQuery(ev.target.value)} />
        </span>
        {records.length ? (
          <ul className="hub__records">
            {records.map((d) => {
              const status = snapshot.data?.equipment[d.id];
              return (
                <li key={d.id}>
                  <Link className="hub__record" to={`/equipment/${encodeURIComponent(d.id)}`}>
                    <span className="hub__row-title">{d.label}</span>
                    <span className="hub__row-meta">{s.families[d.family]}</span>
                    {status && <StateLabel state={status.state} stale={status.stale} />}
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="hub__empty">{e.noRecords}</p>
        )}
      </section>

      <section id="hub-simulation" className="hub__section" aria-labelledby="hub-simulation-title">
        <div className="hub__section-head">
          <h2 id="hub-simulation-title">{s.nav.pages.simulation}</h2>
          <span className="tag-chip tag-chip--demo">{s.simulation.mock}</span>
        </div>
        <p>{e.simulationBody}</p>
        <p className="hub__needs num">
          {sim.run && sim.run.runId === sim.runId
            ? e.simulationRun(sim.run.runId, s.simulation.state[sim.run.state], sim.run.scenario.label)
            : e.simulationNoRun}{" "}
        </p>
        <p className="hub__links">
          <Link className="link" to={targetPath({ type: "simulation" })}>
            {e.openSimulation}
          </Link>
          <button type="button" className="text-button" onClick={() => operating.openWorkspace("pilot")}>
            {e.startSimulation}
          </button>
        </p>
      </section>

      <section id="hub-cad" className={`hub__section${focus === "cad" ? " is-target" : ""}`} aria-labelledby="hub-cad-title" tabIndex={-1}>
        <div className="hub__section-head">
          <h2 id="hub-cad-title">{e.cad}</h2>
          <span className="tag-chip tag-chip--planned" title={s.nav.plannedTitle(s.planned.screens.cad.milestone)}>
            {s.nav.planned}
          </span>
        </div>
        <p>{e.cadBody}</p>
        <p className="hub__needs">{e.cadNeeds}</p>
        <div className="hub__evidence">
          <div className="hub__section-head">
            <h3>{e.evidence}</h3>
            <span className="tag-chip">{e.revision(site.topology.configRevision)}</span>
          </div>
          <div className="evbar" role="img" aria-label={`${evidence.map((x) => `${x.n} ${s.evidence[x.ev].toLowerCase()}`).join(", ")}, ${e.connections(links.length)}`}>
            {evidence.map((x) => (
              <i key={x.ev} className={`evbar__${x.ev}`} style={{ width: `${(x.n / links.length) * 100}%` }} />
            ))}
          </div>
          <p className="evlegend num" aria-hidden="true">
            {evidence.map((x) => (
              <span key={x.ev}>
                <b>{x.n}</b> {s.evidence[x.ev].toLowerCase()}
              </span>
            ))}
            <span>{e.connections(links.length)}</span>
          </p>
          <ul className="hub__rows">
            {review.map((l) => {
              const anchor = anchorOf(l);
              return (
                <li key={l.id} className="hub__review">
                  <span className="hub__row-main">
                    <span className="hub__row-title">
                      {labelOf(l.from)} {s.inspector.to.toLowerCase()} {labelOf(l.to)}
                    </span>
                    <span className={`badge badge--${l.evidence}`}>{s.evidence[l.evidence]}</span>
                  </span>
                  {l.note && <span className="hub__row-meta">{l.note}</span>}
                  {anchor && canLocate && (
                    <button type="button" className="icon-button" aria-label={s.attention.locate(labelOf(l.from))} title={s.inspector.locate} onClick={() => showOnPlant(anchor)}>
                      <Crosshair size={16} aria-hidden="true" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    </div>
  );
}
