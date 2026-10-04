/**
 * Equipment "paint": one material per operating state, applied through shared SVG
 * gradients so every machine shades consistently. Render <SpriteDefs /> once inside
 * any top-level <svg> (or a hidden one on the page) that draws equipment sprites.
 */

export type OperatingState = "running" | "stopped" | "fault" | "unavailable";

interface Material {
  hi: string; // specular highlight
  lt: string; // lit face
  base: string; // body colour
  dk: string; // shaded face
  deep: string; // core shadow
  edge: string; // outline
}

// Running is glossy green and stopped is bare silver metal, as in the reference plant
// view. Fault keeps the machine recognisable in an alarm red; unavailable is a dark
// slate ghost because the state is unknown, not "off".
export const materials: Record<OperatingState, Material> = {
  running: { hi: "#eaffec", lt: "#9df0a8", base: "#55cf66", dk: "#2f9f45", deep: "#1a6a2e", edge: "#0b3a18" },
  stopped: { hi: "#ffffff", lt: "#e4e9ef", base: "#bcc5d0", dk: "#8d98a6", deep: "#5f6977", edge: "#2b323c" },
  fault: { hi: "#ffe6e6", lt: "#f6a5a5", base: "#df6164", dk: "#ad3b41", deep: "#722128", edge: "#3d0e13" },
  unavailable: { hi: "#7d8ba0", lt: "#5e6c82", base: "#475469", dk: "#364051", deep: "#272f3c", edge: "#9aa6b8" },
};

export type Finish = "cylH" | "cylV" | "face" | "side" | "top" | "disc" | "recess";

export function paint(state: OperatingState, finish: Finish): string {
  return `url(#eq-${state}-${finish})`;
}

function MaterialGradients({ state, m }: { state: OperatingState; m: Material }) {
  const id = (f: Finish) => `eq-${state}-${f}`;
  return (
    <>
      {/* Cylinder lying horizontally: light catches the upper third. */}
      <linearGradient id={id("cylH")} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={m.dk} />
        <stop offset="0.14" stopColor={m.lt} />
        <stop offset="0.3" stopColor={m.hi} />
        <stop offset="0.46" stopColor={m.lt} />
        <stop offset="0.74" stopColor={m.base} />
        <stop offset="0.92" stopColor={m.dk} />
        <stop offset="1" stopColor={m.deep} />
      </linearGradient>
      {/* Cylinder standing vertically: light from the upper left. */}
      <linearGradient id={id("cylV")} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor={m.deep} />
        <stop offset="0.12" stopColor={m.dk} />
        <stop offset="0.34" stopColor={m.lt} />
        <stop offset="0.46" stopColor={m.hi} />
        <stop offset="0.6" stopColor={m.lt} />
        <stop offset="0.86" stopColor={m.base} />
        <stop offset="1" stopColor={m.dk} />
      </linearGradient>
      <linearGradient id={id("face")} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={m.lt} />
        <stop offset="0.55" stopColor={m.base} />
        <stop offset="1" stopColor={m.dk} />
      </linearGradient>
      <linearGradient id={id("side")} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={m.dk} />
        <stop offset="1" stopColor={m.deep} />
      </linearGradient>
      <linearGradient id={id("top")} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor={m.hi} />
        <stop offset="1" stopColor={m.lt} />
      </linearGradient>
      <radialGradient id={id("disc")} cx="0.38" cy="0.34" r="0.75">
        <stop offset="0" stopColor={m.hi} />
        <stop offset="0.35" stopColor={m.lt} />
        <stop offset="0.75" stopColor={m.base} />
        <stop offset="1" stopColor={m.dk} />
      </radialGradient>
      <radialGradient id={id("recess")} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor={m.dk} />
        <stop offset="0.8" stopColor={m.deep} />
        <stop offset="1" stopColor={m.edge} />
      </radialGradient>
    </>
  );
}

export function SpriteDefs() {
  return (
    <defs>
      {(Object.keys(materials) as OperatingState[]).map((state) => (
        <MaterialGradients key={state} state={state} m={materials[state]} />
      ))}
      {/* Pump coupling-guard window (pump sprite coordinates). */}
      <clipPath id="eq-pump-guard">
        <rect x={42.8} y={21.8} width={7.4} height={14.4} />
      </clipPath>
      {/* Dark glass for controller displays. */}
      <linearGradient id="eq-glass" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#0e1d17" />
        <stop offset="1" stopColor="#04100a" />
      </linearGradient>
    </defs>
  );
}
