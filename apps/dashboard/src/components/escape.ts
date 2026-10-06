import { useEffect, useRef } from "react";

/**
 * Whether an Escape key press should close a details panel. It should not when
 * another layer already handled it (a popover) or when focus is in an area that owns
 * its own keys, marked `data-escape-ignore` (the assistant's composer and answers).
 */
export function closesOnEscape(e: KeyboardEvent) {
  if (e.key !== "Escape" || e.defaultPrevented) return false;
  const t = e.target;
  return !(t instanceof Element && t.closest("[data-escape-ignore]"));
}

// Open popover layers (tray, legend, menus, the shortcuts list), most recent last.
const layers: (() => void)[] = [];
function onEscape(e: KeyboardEvent) {
  if (e.key !== "Escape" || e.defaultPrevented || !layers.length) return;
  e.preventDefault();
  layers[layers.length - 1]();
}

/**
 * While `open`, Escape closes this layer and nothing else: the most recently opened
 * layer first, before Details (which skip a handled Escape).
 */
export function useEscapeLayer(open: boolean, close: () => void) {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (!open) return;
    const fn = () => latest.current();
    layers.push(fn);
    if (layers.length === 1) document.addEventListener("keydown", onEscape, true);
    return () => {
      layers.splice(layers.indexOf(fn), 1);
      if (!layers.length) document.removeEventListener("keydown", onEscape, true);
    };
  }, [open]);
}

/** While `open`, a pointer press outside `ref` closes it. */
export function useDismissOutside(open: boolean, ref: React.RefObject<HTMLElement | null>, close: () => void, ignore?: React.RefObject<HTMLElement | null>) {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !ignore?.current?.contains(t)) latest.current();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open, ref, ignore]);
}
