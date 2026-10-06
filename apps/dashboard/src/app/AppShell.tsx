import { useEffect, useState, type CSSProperties } from "react";
import { Outlet, useLocation } from "react-router";
import { useStrings } from "../lib/i18n";
import { closesOnEscape } from "../components/escape";
import { Deck } from "./Deck";
import { Dock } from "./Dock";
import { segmentOf } from "./navigation";
import { getOperating, NARROW, operating, useOperating, WIDE } from "./operatingContext";
import { Shortcuts, useShortcuts } from "./Shortcuts";
import { SiteProvider } from "./site";
import { TopBar } from "./TopBar";
import { useMedia } from "./useMedia";
import { useWorkspaceLayout } from "./useWorkspaceLayout";
import { Workspace } from "./workspace/Workspace";
import "./app.css";

const TICK_MS = 250;

/**
 * The instrument: a top bar, the dock, the plant (or page) display with the deck
 * under it, and the workspace display. At 1440 px and wider the workspace is docked
 * beside the page; below that it collapses to a dock and its panel floats over the
 * drawing; on a phone it is a full-screen sheet.
 */
export function AppShell() {
  return (
    <SiteProvider>
      <Shell />
    </SiteProvider>
  );
}

function Shell() {
  const s = useStrings();
  const location = useLocation();
  const section = segmentOf(location.pathname);
  const wide = useMedia(WIDE);
  const narrow = useMedia(NARROW);
  const workspace = useOperating((x) => x.workspace);
  const layout = useWorkspaceLayout();
  const [keys, setKeys] = useState(false);
  useShortcuts(() => setKeys((v) => !v));

  // The demo source clock. Independent of any screen being open.
  useEffect(() => {
    const t = setInterval(() => operating.tick(TICK_MS), TICK_MS);
    return () => clearInterval(t);
  }, []);

  // A window that stops being wide collapses an open workspace rather than covering
  // the drawing with it; one opened for Details stays and floats.
  useEffect(() => {
    const w = getOperating().workspace;
    if (!wide && w.open && !w.autoOpened) operating.hideWorkspace();
  }, [wide]);

  // The phone sheet covers the screen; nothing behind it takes focus.
  const sheet = layout === "sheet";

  // Escape closes a floating workspace once nothing above it (a popover, Details) is open.
  useEffect(() => {
    if (layout !== "float") return;
    const onKey = (e: KeyboardEvent) => {
      const o = getOperating();
      if (!closesOnEscape(e) || o.selectedId || o.kpiKey) return;
      operating.closeWorkspace();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [layout]);

  return (
    <div className="shell" data-workspace={layout} style={{ "--ws-width": `${workspace.width}px` } as CSSProperties}>
      <a className="skip-link" href="#main">
        {s.app.skipToContent}
      </a>
      <TopBar phone={narrow} inert={sheet} />
      <Dock onShortcuts={() => setKeys((v) => !v)} shortcutsOpen={keys} inert={sheet} />
      <main id="main" className="main" tabIndex={-1} inert={sheet} data-float={layout === "float" || undefined}>
        <div className={`main__view${section === "" ? " main__view--stage" : ""}`}>
          <Outlet />
        </div>
      </main>
      <Deck inert={sheet} />
      <Workspace layout={layout} />
      <Shortcuts open={keys} onClose={() => setKeys(false)} />
    </div>
  );
}
