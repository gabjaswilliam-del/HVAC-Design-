import { useLocation, useNavigate } from "react-router";
import { navSearch } from "./navigation";
import { operating } from "./operatingContext";

/**
 * Centre equipment on the Overview's drawing, from any screen. With `select`, it also
 * opens its Details (taking focus); elsewhere the Overview opens with it located.
 */
export function useShowOnPlant() {
  const location = useLocation();
  const navigate = useNavigate();
  return (id: string, select = true) => {
    if (location.pathname === "/") {
      if (select) operating.select(id, true);
      operating.setOverviewView("schematic");
      operating.locate(id);
      return;
    }
    const next = new URLSearchParams(navSearch(location.search));
    next.set("equipment", id);
    next.set("locate", "1");
    navigate({ pathname: "/", search: `?${next}` });
  };
}
