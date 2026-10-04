import {
  BookOpen,
  Bot,
  ClipboardCheck,
  Cog,
  FlaskConical,
  MessageSquareText,
  MonitorDot,
  PencilRuler,
  Server,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import type { Messages } from "../lib/i18n/en";

type NavKey = Exclude<keyof Messages["nav"], "label" | "groups">;

export interface NavItem {
  key: NavKey;
  path: string;
  icon: LucideIcon;
}

export interface NavGroup {
  key: keyof Messages["nav"]["groups"];
  items: NavItem[];
}

// Daily operation first; engineering and setup/maintenance are grouped separately.
export const navGroups: NavGroup[] = [
  {
    key: "operation",
    items: [
      { key: "monitoring", path: "/", icon: MonitorDot },
      { key: "equipment", path: "/equipment", icon: Cog },
      { key: "prediction", path: "/prediction", icon: TrendingUp },
      { key: "agent", path: "/agent", icon: MessageSquareText },
      { key: "simulation", path: "/simulation", icon: FlaskConical },
      { key: "pilot", path: "/pilot", icon: Bot },
    ],
  },
  {
    key: "engineering",
    items: [
      { key: "cad", path: "/cad", icon: PencilRuler },
      { key: "knowledge", path: "/knowledge", icon: BookOpen },
    ],
  },
  {
    key: "administration",
    items: [
      { key: "setup", path: "/setup", icon: ClipboardCheck },
      { key: "system", path: "/system", icon: Server },
    ],
  },
];
