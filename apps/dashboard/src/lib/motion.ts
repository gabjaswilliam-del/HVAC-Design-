/**
 * Motion that carries meaning: a state arriving, what changed, where to look. GSAP core
 * only (no plugins), and only for choreography CSS handles awkwardly: several elements in
 * sequence, items that are new since the last render, a control drawing the eye. Hover,
 * focus and press stay in CSS.
 *
 * Treatment A's motion: transform and opacity only, at its 140, 220 and 320 ms, on its
 * curves. Every tween ends on the element's CSS state (`clearProps`), so nothing depends on
 * motion having run. With `prefers-reduced-motion` nothing animates: the final state is
 * immediate. While anything moves, `<html data-motion="busy">` is set (accessibility checks
 * wait for it).
 */
import { gsap } from "gsap";

const EASE = "expo.out"; // close to --ease, cubic-bezier(.16, 1, .3, 1)
const EASE_IO = "power2.inOut"; // --ease-io, cubic-bezier(.65, 0, .35, 1)
const BASE = 0.22; // --motion-base
const PANEL = 0.32; // --motion-panel
const TRAVEL = 0.5; // a camera crossing a 3D view: long enough to keep one's bearings
const TRAVEL_FAR = 0.65; // the same, to or from a whole group or the overview (a bigger change of scale)
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

let moving = 0;
const busy = (delta: number) => {
  moving = Math.max(0, moving + delta);
  if (typeof document === "undefined") return;
  if (moving) document.documentElement.dataset.motion = "busy";
  else delete document.documentElement.dataset.motion;
};
const tracked = (vars: gsap.TweenVars): gsap.TweenVars => {
  busy(1);
  let done = false;
  const finish = () => {
    if (!done) busy(-1);
    done = true;
  };
  return { ...vars, onComplete: finish, onInterrupt: finish };
};
const live = (els: (Element | null | undefined)[]) => els.filter((e): e is Element => Boolean(e?.isConnected));

export const motion = {
  /** A block that arrived because the state changed (set up → running → summary): its
   *  parts settle in one after another, top to bottom. */
  arrive(parts: (Element | null | undefined)[]) {
    const els = live(parts);
    if (!els.length || reduced()) return;
    gsap.killTweensOf(els);
    gsap.fromTo(
      els,
      { autoAlpha: 0, y: 10 },
      tracked({ autoAlpha: 1, y: 0, duration: PANEL, ease: EASE, stagger: 0.05, clearProps: "opacity,visibility,transform" }),
    );
  },
  /** Items new since the last look (a finding): they rise into the list, so the newest is
   *  seen arriving without reading the list again. */
  added(items: (Element | null | undefined)[]) {
    const els = live(items);
    if (!els.length || reduced()) return;
    gsap.killTweensOf(els);
    gsap.fromTo(els, { autoAlpha: 0, y: 6 }, tracked({ autoAlpha: 1, y: 0, duration: PANEL, ease: EASE, stagger: 0.06, clearProps: "opacity,visibility,transform" }));
  },
  /** A state that changed in place (running to paused, a count that rose): one brief
   *  emphasis, never a loop. */
  changed(el: Element | null | undefined) {
    if (!el?.isConnected || reduced()) return;
    gsap.killTweensOf(el);
    gsap.fromTo(el, { scale: 0.94, autoAlpha: 0.4 }, tracked({ scale: 1, autoAlpha: 1, duration: BASE, ease: EASE, clearProps: "opacity,visibility,transform" }));
  },
  /** A view moving to show something (a graph's camera to the chosen node): one glide on
   *  the panel curve. With reduced motion it is there at once. Returns a stop function. */
  glide<T extends Record<string, number>>(from: T, to: T, update: (v: T) => void): () => void {
    if (reduced()) {
      update(to);
      return () => {};
    }
    const v = { ...from };
    const tween = gsap.to(v, tracked({ ...to, duration: PANEL, ease: EASE, onUpdate: () => update(v) }));
    return () => tween.kill();
  },
  /** A camera travelling through a 3D view to what was chosen (it turns and closes in at
   *  once, so it eases in and out rather than arriving at speed); `far` for a whole group or
   *  the overview. With reduced motion it is there at once. Returns a stop function. */
  travel<T extends Record<string, number>>(from: T, to: T, update: (v: T) => void, far = false): () => void {
    if (reduced()) {
      update(to);
      return () => {};
    }
    const v = { ...from };
    const tween = gsap.to(v, tracked({ ...to, duration: far ? TRAVEL_FAR : TRAVEL, ease: EASE_IO, onUpdate: () => update(v) }));
    return () => tween.kill();
  },
  /** Many marks changing emphasis in place at once (the 3D graph fading what a choice does
   *  not concern): `update` gets the progress from 0 to 1. With reduced motion it is 1 at
   *  once. Returns a stop function. */
  blend(update: (t: number) => void): () => void {
    if (reduced()) {
      update(1);
      return () => {};
    }
    const v = { t: 0 };
    const tween = gsap.to(v, tracked({ t: 1, duration: PANEL, ease: EASE, onUpdate: () => update(v.t) }));
    return () => tween.kill();
  },
  /** A control someone was pointed to: it swells twice inside its ring, then rests. The
   *  ring is CSS (`[data-pointed]`), so it stays, still, until the pointer is cleared. */
  point(el: Element | null | undefined) {
    if (!el?.isConnected || reduced()) return;
    gsap.killTweensOf(el);
    gsap.fromTo(el, { scale: 1 }, tracked({ scale: 1.06, duration: BASE, ease: EASE_IO, yoyo: true, repeat: 3, clearProps: "transform" }));
  },
};
