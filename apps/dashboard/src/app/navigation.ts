import { BookOpen, ChartLine, ClipboardCheck, DraftingCompass, Factory, Server, type LucideIcon } from "lucide-react";
import type { Messages } from "../lib/i18n/en";
import type { NavTarget } from "../lib/contracts/agent";

type SectionKey = keyof Messages["nav"]["sections"];
export type PageKey = keyof Messages["nav"]["pages"];

export interface NavSection {
  key: SectionKey;
  /** Where the section opens. Existing URLs stay as they were. */
  path: string;
  icon: LucideIcon;
  /** First path segments that belong to the section. */
  match: string[];
}

// Four everyday destinations in the dock; the assistant and pilot live in the
// workspace, and setup and maintenance in the System menu.
export const sections: NavSection[] = [
  { key: "overview", path: "/", icon: Factory, match: [""] },
  { key: "analytics", path: "/prediction", icon: ChartLine, match: ["prediction", "trend"] },
  { key: "engineering", path: "/engineering", icon: DraftingCompass, match: ["engineering", "equipment", "simulation", "cad"] },
  { key: "knowledge", path: "/knowledge", icon: BookOpen, match: ["knowledge"] },
];

export const systemLinks: { page: PageKey; path: string; icon: LucideIcon; planned: string }[] = [
  { page: "system", path: "/system", icon: Server, planned: "M7" },
  { page: "setup", path: "/setup", icon: ClipboardCheck, planned: "M7" },
];

/** First path segment: "/equipment/x" and "/equipment" are the same screen. */
export const segmentOf = (pathname: string) => pathname.split("/")[1] ?? "";

export const sectionOf = (pathname: string) => sections.find((s) => s.match.includes(segmentOf(pathname)));

// The page name in the top bar (the screen's h1). Engineering's records and planned
// rows are part of its hub; Simulation is its own screen in the Engineering section.
const PAGES: Record<string, PageKey> = {
  "": "overview",
  prediction: "prediction",
  trend: "trend",
  engineering: "engineering",
  equipment: "engineering",
  simulation: "simulation",
  cad: "engineering",
  agent: "agent",
  knowledge: "knowledge",
  setup: "setup",
  system: "system",
};

/** The page at a path, or undefined for an address with no screen. One recorded run
 *  (`/simulation/RUN-0001`) is the Simulation replay; the history lists them all. */
export const pageOf = (pathname: string): PageKey | undefined =>
  segmentOf(pathname) === "simulation" && pathname.split("/")[2] ? "replay" : PAGES[segmentOf(pathname)];

/** What the main display shows. AI Pilot's run (`pilot`) is shown in the workspace instead. */
export type RouteTarget = Exclude<NavTarget, { type: "pilot" }>;

/**
 * The one map from a typed address to the screen that shows it. Links in answers, the
 * simulation screens and the assistant's actions all go through it: a target is validated
 * data, never a URL.
 */
export function targetPath(target: RouteTarget): string {
  const q = (params: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined)).toString();
    return p ? `?${p}` : "";
  };
  switch (target.type) {
    case "monitoring_kpi":
      return `/?kpi=${encodeURIComponent(target.kpi)}`;
    case "equipment":
      return `/?equipment=${encodeURIComponent(target.id)}&locate=1`;
    case "prediction":
      return target.forecastId ? `/prediction?forecast=${encodeURIComponent(target.forecastId)}` : "/prediction";
    case "equipment_page":
      return target.id ? `/equipment/${encodeURIComponent(target.id)}` : "/equipment";
    case "simulation":
      return target.runId
        ? `/simulation/${encodeURIComponent(target.runId)}${q({ issue: target.issueId, equipment: target.equipmentId, compare: target.compareWith })}`
        : "/simulation";
    case "metric":
      return `/trend${q({ metric: target.key, hours: target.hours === undefined ? undefined : String(target.hours) })}`;
  }
}

/** The Knowledge page's own address: its tab, views and what is open in them. */
export const KNOWLEDGE_PARAMS = ["kn", "kv", "doc", "passage", "node", "edge", "q", "mem", "mlink", "mv", "gv"];

/** Navigation keeps the demo context (scenario, time, `knowledge=local`) but drops a
 *  page's own selection: the Overview's and the Knowledge page's. */
export const navSearch = (search: string) => {
  const p = new URLSearchParams(search);
  for (const key of ["equipment", "kpi", "locate", "view", ...KNOWLEDGE_PARAMS]) p.delete(key);
  const q = p.toString();
  return q ? `?${q}` : "";
};
