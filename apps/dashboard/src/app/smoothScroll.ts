/**
 * Smooth wheel scrolling for the main display's long pages (the Simulation view, Simulation
 * history, equipment records, Engineering): continuous instead of notched for mouse-wheel
 * users at a desk. Only there. The workspace and the conversation keep native scrolling,
 * as does anything inside a page with its own scroll (`allowNestedScroll`) and the plant
 * drawing, whose wheel zooms. Keyboard and focus scrolling stay native (Lenis follows
 * them). Off on the Overview's stage (it does not scroll), for touch and coarse pointers,
 * on a phone (the window scrolls there) and with `prefers-reduced-motion`.
 */
import { useEffect, type RefObject } from "react";
import Lenis from "lenis";
import { NARROW } from "./operatingContext";

/** Where the wheel belongs to something else: the plant drawing, marked regions, fields. */
const PREVENT = ".plant-view, [data-lenis-prevent], textarea, select";

let main: Lenis | null = null;

// Frames run only while a glide does: an idle page costs nothing. Lenis is given a clock
// that pauses with them, so a glide never starts by jumping the idle gap.
let frame = 0;
let clock = 0;
let last = 0;
const tick = (now: number) => {
  clock += last ? now - last : 16;
  last = now;
  main?.raf(clock);
  if (main?.isScrolling === "smooth") frame = requestAnimationFrame(tick);
  else frame = last = 0;
};
const wake = () => {
  if (!frame) frame = requestAnimationFrame(tick);
};
const sleep = () => {
  cancelAnimationFrame(frame);
  frame = last = 0;
};

/** Scroll the main display, through Lenis while it runs so no glide carries the old
 *  position on (a new screen opens at its top). */
export function scrollMainTo(el: HTMLElement | null, top: number) {
  if (main) main.scrollTo(top, { immediate: true, force: true });
  else el?.scrollTo(0, top);
}

export function useMainScroll(view: RefObject<HTMLDivElement | null>, onPage: boolean) {
  useEffect(() => {
    const wrapper = view.current;
    if (!wrapper || !onPage) return;
    const queries = [matchMedia("(pointer: fine)"), matchMedia("(prefers-reduced-motion: reduce)"), matchMedia(NARROW)];
    const setup = () => {
      sleep();
      main?.destroy();
      main = null;
      const [fine, reduce, narrow] = queries;
      if (!fine.matches || reduce.matches || narrow.matches) return;
      main = new Lenis({
        wrapper,
        content: wrapper,
        eventsTarget: wrapper,
        autoRaf: false,
        smoothWheel: true,
        syncTouch: false,
        lerp: 0.16,
        // Pages grow as data arrives: read the scroll height live rather than on resize.
        naiveDimensions: true,
        allowNestedScroll: true,
        stopInertiaOnNavigate: true,
        prevent: (node) => node.matches(PREVENT),
      });
      main.on("virtual-scroll", wake);
    };
    setup();
    queries.forEach((q) => q.addEventListener("change", setup));
    return () => {
      queries.forEach((q) => q.removeEventListener("change", setup));
      sleep();
      main?.destroy();
      main = null;
    };
  }, [onPage]);
}
