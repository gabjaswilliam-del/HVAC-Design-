import { BookOpen, ChartLine, ClipboardCheck, DraftingCompass, Factory, Server, type LucideIcon } from "lucide-react";
import type { Messages } from "../lib/i18n/en";

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
  { key: "analytics", path: "/prediction", icon: ChartLine, match: ["prediction"] },
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
// rows are part of its hub.
const PAGES: Record<string, PageKey> = {
  "": "overview",
  prediction: "prediction",
  engineering: "engineering",
  equipment: "engineering",
  simulation: "engineering",
  cad: "engineering",
  agent: "agent",
  pilot: "pilot",
  knowledge: "knowledge",
  setup: "setup",
  system: "system",
};

/** The page at a path, or undefined for an address with no screen. */
export const pageOf = (pathname: string): PageKey | undefined => PAGES[segmentOf(pathname)];

/** Navigation keeps the demo context (scenario, time) but drops the Overview's selection. */
export const navSearch = (search: string) => {
  const p = new URLSearchParams(search);
  for (const key of ["equipment", "kpi", "locate", "view"]) p.delete(key);
  const q = p.toString();
  return q ? `?${q}` : "";
};
