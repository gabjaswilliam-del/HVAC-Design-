import { useEffect, useState } from "react";

/**
 * Returns `restore(selector)`: focuses the matching element after React has committed
 * the change that requested it (e.g. a closed panel), instead of guessing with a timer.
 */
export function useRestoreFocus() {
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    if (!target) return;
    const el = document.querySelector<HTMLElement>(target);
    if (el) {
      el.focus();
      setTarget(null);
    }
  });
  return setTarget;
}
