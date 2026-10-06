import { useEffect, useState } from "react";

/**
 * Returns `restore(selectors)`: focuses the first selector that matches, after React
 * has committed the change that requested it (e.g. a closed panel), instead of
 * guessing with a timer. Later selectors are fallbacks for a control that is gone.
 */
export function useRestoreFocus() {
  const [target, setTarget] = useState<string[] | null>(null);
  useEffect(() => {
    if (!target) return;
    const el = target.map((s) => document.querySelector<HTMLElement>(s)).find(Boolean);
    if (el) {
      el.focus();
      setTarget(null);
    }
  });
  return (...selectors: string[]) => setTarget(selectors);
}
