import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import "./styles/base.css";
import { router } from "./app/routes";
import { en } from "./lib/i18n/en";

// Demo data is an explicit build/run mode (`npm run demo`). Without it there is no
// local API client yet, so say so instead of silently showing fixtures.
const isDemo = import.meta.env.MODE === "demo";

function NotConnected() {
  return (
    <main className="planned">
      <h1>{en.dataMode.notConnectedTitle}</h1>
      <p>{en.dataMode.notConnectedBody}</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isDemo ? <RouterProvider router={router} /> : <NotConnected />}</StrictMode>,
);
