/**
 * What both 3D views share (the RAG Graph's planetary systems and Graph Memory's
 * constellation): vector arithmetic, the parts of three's camera and OrbitControls they set,
 * whether the browser can draw WebGL (and whether in software), the guard that hands a failing
 * 3D view over to 2D, and the pointer helpers that let a drag started on a name move the view.
 */
import { Component, type ReactNode } from "react";

export interface V3 {
  x: number;
  y: number;
  z: number;
}
/** The parts of three's camera and OrbitControls used here (react-force-graph-3d gives them
 *  untyped). */
export interface Camera3 {
  position: V3;
  fov: number;
  near: number;
  updateProjectionMatrix: () => void;
}
export interface Orbit {
  target: V3;
  enableDamping: boolean;
  dampingFactor: number;
  minDistance: number;
  maxDistance: number;
  mouseButtons: { LEFT: number; MIDDLE: number; RIGHT: number };
  touches: { ONE: number; TWO: number };
  screenSpacePanning: boolean;
  zoomToCursor: boolean;
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
}
/** three's `MOUSE` and `TOUCH` actions. */
export const MOUSE = { ROTATE: 0, DOLLY: 1, PAN: 2 } as const;
export const TOUCH = { PAN: 1, DOLLY_ROTATE: 3 } as const;

export const sub = (a: V3, b: V3) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const len = (v: V3) => Math.hypot(v.x, v.y, v.z) || 1;
export const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const unit = (v: V3) => {
  const l = len(v);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};
export const cross = (a: V3, b: V3) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const along = (from: V3, dir: V3, d: number) => {
  const l = len(dir);
  return { x: from.x + (dir.x / l) * d, y: from.y + (dir.y / l) * d, z: from.z + (dir.z / l) * d };
};
export const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
export const forcedColors = () => typeof matchMedia === "function" && matchMedia("(forced-colors: active)").matches;

let webgl: boolean | undefined;
let software = false;
/** Whether this browser can draw WebGL (asked once; the test context is released). */
export function canDraw3d() {
  if (webgl === undefined) {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (gl) {
        const info = gl.getExtension("WEBGL_debug_renderer_info");
        software = /swiftshader|llvmpipe|softpipe|basic render|software/i.test(String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)));
      }
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      webgl = Boolean(gl);
    } catch {
      webgl = false;
    }
  }
  return webgl;
}
/** Whether WebGL is drawn in software (no graphics processor: SwiftShader, llvmpipe, a basic
 *  display driver), where every frame costs the processor dearly. */
export const drawsInSoftware = () => canDraw3d() && software;

/** If a 3D view throws (a graphics context that cannot be created), show 2D instead. */
export class ThreeGuard extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Touch pans are measured in page coordinates, which Chromium leaves unscrolled on a touch's
 *  first event and on a handed-over press while the page is scrolled (a phone scrolls the
 *  whole page): set them from the client position, so a drag does not jump by the scroll. */
export function touchPageXY(e: React.PointerEvent) {
  if (e.pointerType !== "touch") return;
  const n = e.nativeEvent;
  Object.defineProperties(n, { pageX: { value: n.clientX + window.scrollX }, pageY: { value: n.clientY + window.scrollY } });
}

/** A press on a name is a click until the pointer moves; then it is handed to the camera
 *  controls on `canvas` (they capture the pointer from there), so a drag that starts on a name
 *  moves the view like one on the canvas, and chooses nothing. */
export function handOverPointer(e: React.PointerEvent, canvas: HTMLCanvasElement | undefined) {
  if (!canvas) return;
  const { pointerId, pointerType, isPrimary, button, buttons, clientX, clientY, shiftKey, ctrlKey, metaKey, altKey } = e;
  const done = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", done);
    window.removeEventListener("pointercancel", done);
  };
  const move = (m: PointerEvent) => {
    if (m.pointerId !== pointerId || Math.hypot(m.clientX - clientX, m.clientY - clientY) < 4) return;
    done();
    canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true, pointerId, pointerType, isPrimary, button, buttons, clientX, clientY, shiftKey, ctrlKey, metaKey, altKey }));
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", done);
  window.addEventListener("pointercancel", done);
}
