import { useLocation } from "react-router";
import { segmentOf } from "./navigation";
import { NARROW, useOperating, WIDE } from "./operatingContext";
import { useMedia } from "./useMedia";

/**
 * docked: a display beside the page (1440 px and wider)
 * float: a panel over the drawing beside the collapsed dock (below 1440 px)
 * collapsed: the dock only; sheet: full screen on a phone; hidden: on the full assistant page
 */
export type WorkspaceLayout = "docked" | "float" | "collapsed" | "sheet" | "hidden";

export function useWorkspaceLayout(): WorkspaceLayout {
  const location = useLocation();
  const wide = useMedia(WIDE);
  const narrow = useMedia(NARROW);
  const open = useOperating((x) => x.workspace.open);
  // The full assistant page is the workspace expanded, so it is not shown twice.
  if (segmentOf(location.pathname) === "agent") return "hidden";
  if (narrow) return open ? "sheet" : "hidden";
  if (!open) return "collapsed";
  return wide ? "docked" : "float";
}
