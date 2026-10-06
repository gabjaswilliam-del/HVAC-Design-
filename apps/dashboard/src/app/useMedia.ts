import { useSyncExternalStore } from "react";

/** Whether a CSS media query matches, updated when it changes. */
export function useMedia(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const m = matchMedia(query);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => matchMedia(query).matches,
  );
}
