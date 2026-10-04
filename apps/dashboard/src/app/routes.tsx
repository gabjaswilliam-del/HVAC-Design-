import { PageHeading } from "../components/PageHeading";
import { createBrowserRouter, Link } from "react-router";
import { useStrings } from "../lib/i18n";
import type { Messages } from "../lib/i18n/en";
import { AppShell } from "./AppShell";
import { MonitoringPage } from "../features/monitoring";
import { EquipmentPage } from "../features/equipment";
import { PredictionPage } from "../features/prediction";
import { AgentPage } from "../features/agent";

// ponytail: temporary stand-in for screens built in later milestones; delete when each lands.
function PlannedScreen({ title, milestone }: { title: keyof Messages["nav"]; milestone: string }) {
  const s = useStrings();
  return (
    <section className="planned">
      <PageHeading>{s.nav[title] as string}</PageHeading>
      <p>
        {s.planned.body} {s.planned.milestone} {milestone}.
      </p>
    </section>
  );
}

function NotFound() {
  const s = useStrings();
  return (
    <section className="planned">
      <PageHeading>{s.notFound.heading}</PageHeading>
      <p>{s.notFound.body}</p>
      <Link to="/">{s.notFound.back}</Link>
    </section>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <MonitoringPage /> },
      // One route with an optional ID, so selecting does not remount the page (and its filters).
      { path: "equipment/:equipmentId?", element: <EquipmentPage /> },
      { path: "prediction", element: <PredictionPage /> },
      { path: "agent", element: <AgentPage /> },
      { path: "simulation", element: <PlannedScreen title="simulation" milestone="M6" /> },
      { path: "pilot", element: <PlannedScreen title="pilot" milestone="M6" /> },
      { path: "cad", element: <PlannedScreen title="cad" milestone="M7" /> },
      { path: "knowledge", element: <PlannedScreen title="knowledge" milestone="M7" /> },
      { path: "setup", element: <PlannedScreen title="setup" milestone="M7" /> },
      { path: "system", element: <PlannedScreen title="system" milestone="M7" /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
