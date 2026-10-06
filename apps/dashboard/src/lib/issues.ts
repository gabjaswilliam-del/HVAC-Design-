import type { Issue } from "./contracts";

const RANK = { critical: 0, warning: 1, info: 2 } as const;

/** Open issues, most severe first; within a severity, the newest first. */
export const openIssues = (issues: Issue[] | undefined) =>
  (issues ?? [])
    .filter((i) => i.status !== "resolved")
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || Date.parse(b.firstSeen) - Date.parse(a.firstSeen));
