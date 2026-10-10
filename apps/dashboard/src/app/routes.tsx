import { lazy, Suspense } from "react";
import { createBrowserRouter, Link, Navigate, useLocation } from "react-router";
import { useStrings } from "../lib/i18n";
import { AppShell } from "./AppShell";
import type { PageKey } from "./navigation";
import { MonitoringPage } from "../features/monitoring";
import { EngineeringPage, EquipmentRecordPage } from "../features/engineering";
import { PredictionPage } from "../features/prediction";
import { AgentPage } from "../features/agent";
import { HistoryPage } from "../features/simulation";
import { TrendPage } from "../features/trend";
import { SimulationView } from "../features/pilot";

// The Knowledge workspace (Graph RAG, Graph Memory and their graph explorers) is its own chunk.
const KnowledgePage = lazy(() => import("../features/knowledge"));

// ponytail: shared "not available yet" state for screens built in later milestones; each is replaced when it lands.
function PlannedScreen({ page }: { page: PageKey }) {
  const s = useStrings();
  const info = s.planned.screens[page];
  return (
    <section className="page planned" aria-labelledby="planned-title">
      <div className="planned__head">
        <h2 id="planned-title">{s.planned.unavailable}</h2>
        <span className="tag-chip tag-chip--planned" title={s.nav.plannedTitle(info.milestone)}>
          {s.nav.planned}
        </span>
      </div>
      <p>{info.body}</p>
      <p className="planned__needs">{info.needs}</p>
      <p className="planned__related">
        {s.planned.related}{" "}
        <Link className="link" to="/">
          {s.nav.sections.overview}
        </Link>
        <Link className="link" to="/prediction">
          {s.nav.pages.prediction}
        </Link>
        <Link className="link" to="/engineering">
          {s.nav.sections.engineering}
        </Link>
      </p>
    </section>
  );
}

function PageLoading() {
  const s = useStrings();
  return (
    <section className="page" aria-busy="true">
      <p className="page__sub" role="status">
        {s.app.loading(s.nav.pages.knowledge)}
      </p>
    </section>
  );
}

function NotFound() {
  const s = useStrings();
  return (
    <section className="page planned">
      <p>{s.notFound.body}</p>
      <Link className="link" to="/">
        {s.notFound.back}
      </Link>
    </section>
  );
}

/** The roster is the Overview's list view now; old links keep the demo context. */
function ToOverviewList() {
  const { search } = useLocation();
  const p = new URLSearchParams(search);
  p.set("view", "list");
  return <Navigate replace to={{ pathname: "/", search: `?${p}` }} />;
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <MonitoringPage /> },
      { path: "engineering", element: <EngineeringPage /> },
      { path: "equipment", element: <ToOverviewList /> },
      { path: "equipment/:equipmentId", element: <EquipmentRecordPage /> },
      { path: "prediction", element: <PredictionPage /> },
      { path: "agent", element: <AgentPage /> },
      { path: "simulation", element: <HistoryPage /> },
      { path: "simulation/:runId", element: <SimulationView /> },
      { path: "trend", element: <TrendPage /> },
      { path: "cad", element: <EngineeringPage /> },
      {
        path: "knowledge",
        element: (
          <Suspense fallback={<PageLoading />}>
            <KnowledgePage />
          </Suspense>
        ),
      },
      { path: "setup", element: <PlannedScreen page="setup" /> },
      { path: "system", element: <PlannedScreen page="system" /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
