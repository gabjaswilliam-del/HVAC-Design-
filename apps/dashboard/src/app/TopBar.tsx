import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ChevronDown, CircleCheck, Clock, LocateFixed, MessageSquareText } from "lucide-react";
import { useStrings } from "../lib/i18n";
import { formatNumber, formatTime } from "../lib/format";
import { openIssues } from "../lib/issues";
import type { Reading, SiteBundle, Snapshot } from "../lib/contracts";
import { useDismissOutside, useEscapeLayer } from "../components/escape";
import { ISSUES_KPI } from "../features/monitoring/kpiDefinitions";
import { sceneMatchesTopology } from "../features/monitoring";
import { useLatestForecast } from "../features/prediction";
import { pageOf, segmentOf } from "./navigation";
import { getOperating, operating, useOperating } from "./operatingContext";
import { useIssues, useSite, useSnapshot } from "./site";
import { useShowOnPlant } from "./useShowOnPlant";

const DEMAND = "plant:cooling_demand_kw";
const DELIVERED = "plant:cooling_delivered_kw";
const CAPACITY = "plant:available_capacity_kw";
const COP = "plant:cop";
const TRAY = ["plant:power_kw", "chw_supply:temp_c", "plant:chw_delta_t_c", "plant:approach_c", "weather:wet_bulb_c"];

/** The product mark: a loop in a rounded tile. */
function Mark() {
  return (
    <svg className="mark" viewBox="0 0 28 28" aria-hidden="true">
      <rect x="1" y="1" width="26" height="26" rx="8" className="mark__tile" />
      <path d="M8 9h9.5a3.5 3.5 0 0 1 0 7H10.5a3.5 3.5 0 0 0 0 7H20" className="mark__loop" />
      <circle cx="20" cy="23" r="1.6" className="mark__eye" />
    </svg>
  );
}

/**
 * The top bar: where you are (site / page, the screen's h1), that the data is demo
 * data, the four readings that summarise the plant, and the attention slot. The slot
 * is always reserved, so a new issue never moves the plant.
 */
export function TopBar({ phone, inert }: { phone: boolean; inert?: boolean }) {
  const s = useStrings();
  const location = useLocation();
  const site = useSite();
  const snapshot = useSnapshot();
  const page = pageOf(location.pathname);
  const title = page ? s.nav.pages[page] : s.notFound.heading;
  const heading = useRef<HTMLHeadingElement>(null);
  const segment = segmentOf(location.pathname);
  const lastSegment = useRef(segment);
  const workspaceOpen = useOperating((x) => x.workspace.open);

  // The new screen's heading takes focus after navigation (not on first load), unless
  // focus is in the assistant or AI Pilot: a view either opened appears beside it, which
  // keeps focus (a follow-up can be typed at once, the run operated on).
  useEffect(() => {
    if (lastSegment.current === segment) return;
    lastSegment.current = segment;
    if (document.activeElement?.closest("#assistant-panel, #pilot-panel")) return;
    heading.current?.focus({ preventScroll: true });
  }, [segment]);

  return (
    <header className="topbar" inert={inert}>
      <div className="topbar__site">
        <Mark />
        <div className="site">
          {site.data && (
            <span className="site__name">
              {site.data.site.name}
              <span className="site__sep" aria-hidden="true">
                /
              </span>
            </span>
          )}
          <h1 className="site__page" ref={heading} tabIndex={-1}>
            {title}
          </h1>
        </div>
        <span className="tag-chip tag-chip--demo topbar__demo" title={s.dataMode.demoDescription}>
          {s.dataMode.demo}
        </span>
      </div>
      {site.data ? <Readouts site={site.data} snapshot={snapshot.data} failed={Boolean(snapshot.error)} /> : <div />}
      {site.data ? <Attention site={site.data} title={title} /> : <div className="attention" />}
      {phone && (
        <button
          type="button"
          className="button ws-toggle"
          aria-pressed={workspaceOpen}
          onClick={() => (workspaceOpen ? operating.closeWorkspace() : operating.openWorkspace("assistant"))}
        >
          <MessageSquareText size={16} aria-hidden="true" />
          {s.topBar.assistant}
        </button>
      )}
    </header>
  );
}

function Readouts({ site, snapshot, failed }: { site: SiteBundle; snapshot?: Snapshot; failed: boolean }) {
  const s = useStrings();
  const t = s.topBar;
  const location = useLocation();
  const navigate = useNavigate();
  const kpiKey = useOperating((x) => x.kpiKey);
  const [tray, setTray] = useState(false);
  const trayId = useId();
  const trayRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const tz = site.site.timezone;
  const closeTray = () => {
    setTray(false);
    moreRef.current?.focus();
  };
  useEscapeLayer(tray, closeTray);
  useDismissOutside(tray, trayRef, () => setTray(false), moreRef);

  const info = (key: string) => site.metrics.find((m) => m.key === key);
  const reading = (key: string): Reading | undefined => snapshot?.kpis[key] ?? snapshot?.values[key];
  const stale = snapshot?.connection === "disconnected" || [DEMAND, DELIVERED, COP].some((k) => reading(k)?.quality === "stale");
  const text = (key: string) => {
    const r = reading(key);
    const m = info(key);
    return r && r.value !== null ? `${formatNumber(r.value, m?.decimals ?? 1)}${m?.unit ? ` ${m.unit}` : ""}` : s.quality.unavailable;
  };

  // Details open beside every screen; the full assistant page has no workspace, so
  // its indicators open on the Overview.
  const open = (key: string) => {
    if (segmentOf(location.pathname) === "agent") return navigate({ pathname: "/", search: `?kpi=${encodeURIComponent(key)}` });
    if (getOperating().kpiKey === key) operating.closeKpi();
    else operating.openKpi(key, true);
  };

  const value = (key: string) => {
    const r = reading(key);
    const m = info(key);
    if (!snapshot) return failed ? <span className="readout__missing">{s.quality.unavailable}</span> : <span className="readout__loading" aria-hidden="true" />;
    if (!r || r.value === null) return <span className="readout__missing">{s.quality.unavailable}</span>;
    return (
      <>
        {formatNumber(r.value, m?.decimals ?? 1)}
        {m?.unit && <span className="unit">{m.unit}</span>}
      </>
    );
  };

  const unmet = reading("plant:unmet_kw")?.value ?? 0;
  const readout = (key: string, label: React.ReactNode, extra?: string) => (
    <button
      type="button"
      className="readout"
      data-kpi={key}
      aria-pressed={kpiKey === key}
      aria-controls={kpiKey === key ? "kpi-panel" : undefined}
      aria-label={`${info(key)?.label ?? key}, ${text(key)}${stale ? `, ${s.quality.stale.toLowerCase()}` : ""}${extra ? `, ${extra}` : ""}${s.kpiPanel.showDetails}`}
      onClick={() => open(key)}
    >
      <span className="readout__label">{label}</span>
      <span className="readout__value num">{value(key)}</span>
    </button>
  );

  return (
    <div className={`readouts${stale ? " is-stale" : ""}`} role="group" aria-label={t.readouts}>
      {stale && snapshot?.latestSampleAt && (
        <span className="tag-chip tag-chip--caution readouts__stale num" title={t.staleTitle(formatTime(snapshot.latestSampleAt, tz))}>
          <Clock size={13} aria-hidden="true" />
          {t.stale(formatTime(snapshot.latestSampleAt, tz))}
        </span>
      )}
      <div className="readouts__group">
        <div className="readouts__row">
          {readout(DEMAND, t.demand)}
          {readout(
            DELIVERED,
            <>
              {t.delivered}
              {unmet > 0 && <span className="readout__unmet num">{t.unmet(formatNumber(unmet, 0))}</span>}
            </>,
            unmet > 0 ? t.unmet(formatNumber(unmet, 0)) : undefined,
          )}
          {readout(
            CAPACITY,
            <>
              <span className="readout__long">{t.capacity}</span>
              <span className="readout__short">{t.capacityShort}</span>
            </>,
          )}
        </div>
        <Balance demand={reading(DEMAND)?.value} delivered={reading(DELIVERED)?.value} capacity={reading(CAPACITY)?.value} />
      </div>
      <div className="readouts__group">
        <div className="readouts__row">{readout(COP, t.cop)}</div>
      </div>
      <button
        type="button"
        ref={moreRef}
        className="more"
        aria-expanded={tray}
        aria-controls={trayId}
        aria-label={t.more}
        onClick={() => setTray((v) => !v)}
      >
        <ChevronDown size={16} aria-hidden="true" />
        <span className="more__text">{t.more}</span>
      </button>
      <div className="tray" id={trayId} ref={trayRef} role="region" aria-label={t.more} hidden={!tray}>
        {tray && (
          <>
            <div className="tray__grid">
              {TRAY.map((key) => (
                <button
                  key={key}
                  type="button"
                  className="tray__item"
                  data-kpi={key}
                  aria-pressed={kpiKey === key}
                  onClick={() => {
                    setTray(false);
                    open(key);
                  }}
                >
                  <span className="tray__label">{info(key)?.label ?? key}</span>
                  <span className="tray__value num">{value(key)}</span>
                </button>
              ))}
              <Outlook site={site} onOpen={() => setTray(false)} />
            </div>
            <div className="tray__foot">
              <span>
                {stale && snapshot?.latestSampleAt && `${t.staleNote(formatTime(snapshot.latestSampleAt, tz))} `}
                {t.outlookNote}
              </span>
              <Link className="link" to="/prediction" onClick={() => setTray(false)}>
                {t.openForecast}
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Demand, delivered cooling and running capacity on one scale. Every value is also
 *  printed beside it, so it is hidden from assistive technology. */
function Balance({ demand, delivered, capacity }: { demand?: number | null; delivered?: number | null; capacity?: number | null }) {
  const d = demand ?? null;
  const v = delivered ?? null;
  const max = Math.max(d ?? 0, v ?? 0, capacity ?? 0);
  if (max <= 0 || v === null) return <span className="balance balance--empty" aria-hidden="true" />;
  const pct = (x: number) => `${Math.min(100, (x / max) * 100)}%`;
  return (
    <span className="balance" aria-hidden="true">
      <span className="balance__fill" style={{ width: pct(v) }} />
      {d !== null && d > v && <span className="balance__gap" style={{ left: pct(v), width: pct(d - v) }} />}
      {d !== null && <span className="balance__demand" style={{ left: pct(d) }} />}
    </span>
  );
}

/** The 6-hour outlook: the same forecast as the Prediction page. Loaded when the tray opens. */
function Outlook({ site, onOpen }: { site: SiteBundle; onOpen: () => void }) {
  const s = useStrings();
  const t = s.topBar;
  const forecast = useLatestForecast({ horizonMinutes: 360, stepMinutes: 15, configRevision: site.topology.configRevision });
  const r = forecast.data;
  if (!r || r.status === "unavailable" || !r.summary) {
    return (
      <span className="tray__item tray__item--static">
        <span className="tray__label">{t.outlookUnavailable}</span>
        <span className="tray__value tray__value--muted">{forecast.error || r ? s.forecast.unavailable : ""}</span>
      </span>
    );
  }
  return (
    <Link className="tray__item" to={`/prediction?forecast=${encodeURIComponent(r.forecastId)}`} title={s.forecast.baselineLabel} onClick={onOpen}>
      <span className="tray__label num">{t.outlook(formatTime(r.summary.peakAt, site.site.timezone))}</span>
      <span className="tray__value num">
        {formatNumber(r.summary.peakKw, 0)}
        <span className="unit">kWt</span>
      </span>
    </Link>
  );
}

/**
 * The most severe open issue as one laminate tag with two sibling buttons: open the
 * issues, or acknowledge them (in this browser only). New issues swing in once,
 * pulse until acknowledged, prefix the page title and are announced.
 */
function Attention({ site, title }: { site: SiteBundle; title: string }) {
  const s = useStrings();
  const a = s.attention;
  const issues = useIssues();
  const acknowledged = useOperating((x) => x.acknowledged);
  const kpiKey = useOperating((x) => x.kpiKey);
  const showOnPlant = useShowOnPlant();
  const [announcement, setAnnouncement] = useState("");
  const [swing, setSwing] = useState(0);
  const seen = useRef<Set<string> | null>(null);
  const tz = site.site.timezone;

  const open = openIssues(issues.data?.issues);
  const unacked = open.filter((i) => !acknowledged.includes(i.id));
  // Unacknowledged first within a severity, so the newest alarm is the one on show.
  const top = [...open].sort((x, y) => (x.severity === y.severity ? Number(acknowledged.includes(x.id)) - Number(acknowledged.includes(y.id)) : 0))[0];
  const ids = open.map((i) => i.id).join(",");

  useEffect(() => {
    if (!issues.data) return;
    const fresh = open.filter((i) => !seen.current?.has(i.id) && !acknowledged.includes(i.id));
    const first = seen.current === null;
    seen.current = new Set(open.map((i) => i.id));
    if (!fresh.length) return;
    if (!first) setSwing(Date.now());
    setAnnouncement("");
    const msg = a.announce(s.issues.severity[fresh[0].severity], fresh[0].title);
    const timer = setTimeout(() => setAnnouncement(msg), 30);
    return () => clearTimeout(timer);
  }, [ids, issues.data === undefined]);

  useEffect(() => {
    const lead = unacked[0];
    document.title = `${lead ? a.title(unacked.length, s.issues.severity[lead.severity]) : ""}${s.app.productName} · ${title}`;
  }, [unacked.length, unacked[0]?.severity, title]);

  const live = (
    <p className="visually-hidden" role="alert">
      {announcement}
    </p>
  );

  if (!issues.data) return <div className="attention">{live}</div>;
  if (!top) {
    return (
      <div className="attention">
        <span className="attention__quiet">
          <CircleCheck size={16} aria-hidden="true" />
          {a.quiet}
        </span>
        {live}
      </div>
    );
  }

  const isNew = unacked.length > 0;
  const severity = s.issues.severity[top.severity];
  const meta = a.since(formatTime(top.firstSeen, tz));
  const equipmentId = top.equipmentIds[0];
  const name = site.topology.devices.find((d) => d.id === equipmentId)?.label ?? equipmentId;
  const canLocate = equipmentId && sceneMatchesTopology(site.scene, site.topology);

  return (
    <div className="attention" aria-label={a.label} role="group">
      <div key={swing} className={`tag tag--attention tag--${top.severity}${isNew ? " tag--new" : ""}${swing ? " tag--swing" : ""}`}>
        <button
          type="button"
          className="att__open"
          data-kpi={ISSUES_KPI}
          aria-pressed={kpiKey === ISSUES_KPI}
          aria-label={a.open(severity, top.id, top.title, meta, open.length - 1)}
          onClick={() => (getOperating().kpiKey === ISSUES_KPI ? operating.closeKpi() : operating.openKpi(ISSUES_KPI, true))}
        >
          <span className="tag__eye" />
          <span className="tag__sev">{severity}</span>
          <span className="tag__title">{top.title}</span>
          <span className="tag__sub num">{meta}</span>
          {open.length > 1 && <span className="tag__more num">+{open.length - 1}</span>}
        </button>
        {isNew && (
          <button
            type="button"
            className="ack"
            title={a.acknowledgeTitle}
            onClick={() => {
              operating.acknowledge(open.map((i) => i.id));
              setAnnouncement(a.acknowledged);
            }}
          >
            {a.acknowledge}
          </button>
        )}
      </div>
      {canLocate && (
        <button type="button" className="icon-button" aria-label={a.locate(name)} title={a.locate(name)} onClick={() => showOnPlant(equipmentId)}>
          <LocateFixed size={16} aria-hidden="true" />
        </button>
      )}
      {live}
    </div>
  );
}
