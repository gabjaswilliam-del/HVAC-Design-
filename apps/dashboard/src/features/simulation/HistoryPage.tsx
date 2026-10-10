import { Link } from "react-router";
import { useStrings } from "../../lib/i18n";
import { formatDateTime, formatNumber } from "../../lib/format";
import { useResource } from "../../lib/api/useResource";
import { isFinal, type RunStatus, type RunSummary } from "../../lib/contracts/simulation";
import { Notice } from "../../components/Notice";
import { pilotClient } from "../../app/dataClient";
import { targetPath } from "../../app/navigation";
import { operating } from "../../app/operatingContext";
import { useSite } from "../../app/site";
import { RunStateLabel } from "./labels";
import { hm } from "./RunControls";
import { session, useSimulation } from "./simulationSession";
import "./simulation.css";

/**
 * Simulation history: the archive of every run the service has, newest first, with its
 * name, scenario, figures and whether the pilot's summary is ready. A run opens its replay
 * (the Simulation screen); the live one is operated in AI Pilot, which opens beside this
 * list. Typed address: `{ type: "simulation" }`.
 */
export function HistoryPage() {
  const s = useStrings();
  const h = s.history;
  const site = useSite();
  const sim = useSimulation();
  const tz = site.data?.site.timezone ?? "UTC";
  return (
    <div className="page sim history" aria-busy={(!sim.caps && !sim.capsError) || undefined}>
      <div className="page__head">
        <div className="sim__title-row">
          <h2 className="page__title">{h.title}</h2>
          <span className="tag-chip tag-chip--demo" title={sim.caps?.service.engine}>
            {s.simulation.mock}
          </span>
        </div>
        <p className="page__sub">{h.lead}</p>
      </div>
      {sim.capsError && !sim.caps && (
        <Notice tone="critical" action={{ label: s.simulation.reconnect, onClick: session.retry }}>
          {s.simulation.unavailable} {sim.capsError.message}
        </Notice>
      )}
      {sim.readError && sim.caps && (
        <Notice tone="warning" action={{ label: s.simulation.reconnect, onClick: session.retry }}>
          {s.simulation.disconnectedNoRun}
        </Notice>
      )}
      {sim.caps && site.data && <RunTable timeZone={tz} />}
    </div>
  );
}

/** Every run, newest first, with its figures; the pilot's summary status from the pilot service. */
function RunTable({ timeZone }: { timeZone: string }) {
  const s = useStrings();
  const h = s.history;
  const { runs } = useSimulation();
  const ended = runs.filter((r) => isFinal(r.state)).length;
  // Summaries appear when runs end; read them again when another run has ended.
  const summaries = useResource(`summaries:${ended}`, "history", (signal) => pilotClient.listRunSummaries({ signal }));
  const summaryOf = (id: string) => summaries.data?.find((x) => x.runId === id);
  if (!runs.length) {
    return (
      <p className="sim-empty history__empty">
        {h.empty}{" "}
        <button type="button" className="text-button" onClick={() => openConsole()}>
          {h.startInPilot}
        </button>
      </p>
    );
  }
  return (
    <section className="sim-section" aria-labelledby="history-runs-title">
      <div className="sim-section__head">
        <h2 id="history-runs-title">{h.runs(runs.length)}</h2>
      </div>
      {summaries.error && <p className="sim-muted">{h.summariesUnavailable(summaries.error.message)}</p>}
      <table className="data-table history-table">
        <caption className="visually-hidden">{h.caption}</caption>
        <thead>
          <tr>
            {h.columns.map((c, i) => (
              <th key={c} scope="col" className={NUMERIC_COLUMNS.has(i) ? "num" : undefined}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <HistoryRow key={r.runId} run={r} summary={summaryOf(r.runId)} timeZone={timeZone} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Columns of figures: right-aligned, headers with them. */
const NUMERIC_COLUMNS = new Set([3, 5, 6, 7, 8, 9]);
/** AI Pilot operates a run: its console opens beside the list, with the run if one is named. */
const openConsole = (runId?: string) => {
  if (runId) session.attach(runId);
  operating.openWorkspace("pilot");
};

function HistoryRow({ run, summary, timeZone }: { run: RunStatus; summary: RunSummary | undefined; timeZone: string }) {
  const s = useStrings();
  const h = s.history;
  const live = !isFinal(run.state);
  const st = run.stats;
  const cells = h.columns;
  return (
    <tr data-history-run={run.runId}>
      <th scope="row" data-label={cells[0]}>
        <Link className="link num" to={targetPath({ type: "simulation", runId: run.runId })} aria-label={h.open(run.runId)}>
          {run.runId}
        </Link>
      </th>
      <td data-label={cells[1]} className="history-table__name">
        {run.name}
      </td>
      <td data-label={cells[2]}>{run.scenario.label}</td>
      <td data-label={cells[3]} className="num">
        {formatDateTime(run.createdAt, timeZone)}
      </td>
      <td data-label={cells[4]}>
        <RunStateLabel state={run.state} />
      </td>
      <td data-label={cells[5]} className="num">
        {hm(st.simulatedMinutes)}
      </td>
      <td data-label={cells[6]} className="num">
        {st.avgCop === null ? "–" : formatNumber(st.avgCop, 2)}
      </td>
      <td data-label={cells[7]} className="num">
        {formatNumber(st.energyKwh, 0)} kWh
      </td>
      <td data-label={cells[8]} className="num">
        {formatNumber(st.peakUnmetKw, 0)} kWt
      </td>
      <td data-label={cells[9]} className="num">
        {summary ? (summary.pilot.monitored ? summary.pilot.issues : h.notMonitored) : "–"}
      </td>
      <td data-label={cells[10]}>
        {live ? (
          <button type="button" className="text-button" onClick={() => openConsole(run.runId)}>
            {h.liveInPilot}
          </button>
        ) : summary ? (
          h.summaryReady
        ) : (
          h.summaryMissing
        )}
      </td>
    </tr>
  );
}
