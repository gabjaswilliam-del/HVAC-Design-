import { createBrowserRouter, Link } from "react-router";
import { useStrings } from "../lib/i18n";
import type { Messages } from "../lib/i18n/en";
import { AppShell } from "./AppShell";
import { MonitoringPage } from "../features/monitoring";

// ponytail: temporary stand-in for screens built in later milestones; delete when each lands.
function PlannedScreen({ title, milestone }: { title: keyof Messages["nav"]; milestone: string }) {
  const s = useStrings();
  return (
    <section className="planned">
      <h1 tabIndex={-1}>{s.nav[title] as string}</h1>
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
      <h1 tabIndex={-1}>{s.notFound.heading}</h1>
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
      { path: "equipment", element: <PlannedScreen title="equipment" milestone="M4" /> },
      { path: "prediction", element: <PlannedScreen title="prediction" milestone="M4" /> },
      { path: "agent", element: <PlannedScreen title="agent" milestone="M5" /> },
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
