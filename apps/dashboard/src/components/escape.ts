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

/** A press on one of these is a control's: its click keeps its own action and closes nothing. */
const CONTROL = [
  "a[href]", "button", "input", "select", "textarea", "label", "summary", '[contenteditable="true"]',
  '[role="button"]', '[role="link"]', '[role="tab"]', '[role="tablist"]', '[role="radio"]', '[role="radiogroup"]',
  '[role="checkbox"]', '[role="switch"]', '[role="slider"]', '[role="option"]', '[role="listbox"]',
  '[role="combobox"]', '[role="menu"]', '[role="menuitem"]', '[role="toolbar"]',
].join(", ");
/** A press that moves this far is a drag (as on the plant drawing), not a click. */
const CLICK_SLOP = 4;

/**
 * While `open`, a click on plain space outside `ref` closes it: the drawing's empty space,
 * a bar's background, a page. A click on a control (`CONTROL`, or `ignore`) keeps its own
 * action and closes nothing; so do a drag, a press while a popover layer is open (the
 * click is that layer's, as Escape is), a press in an inert region and a click from the
 * keyboard. Decided at the press, while the page is as the operator saw it, and acted on
 * at the click, after the page's own handlers. Nothing is prevented or stopped.
 */
export function useClickOutside(open: boolean, ref: React.RefObject<HTMLElement | null>, close: () => void, ignore?: string) {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (!open) return;
    let press: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      const t = e.target;
      const plain =
        e.isPrimary &&
        e.button === 0 &&
        !layers.length &&
        t instanceof Element &&
        !ref.current?.contains(t) &&
        !t.closest(CONTROL) &&
        !(ignore && t.closest(ignore)) &&
        !t.closest("[inert]");
      press = plain ? { x: e.clientX, y: e.clientY } : null;
    };
    const click = (e: MouseEvent) => {
      const p = press;
      press = null;
      if (p && e.detail > 0 && Math.hypot(e.clientX - p.x, e.clientY - p.y) < CLICK_SLOP) latest.current();
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("click", click);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("click", click);
    };
  }, [open, ref, ignore]);
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
