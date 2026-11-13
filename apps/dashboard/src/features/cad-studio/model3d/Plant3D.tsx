/**
 * The 3D view's frame, in CAD Studio's own chunk: whether this browser can draw it, the lazy 3D
 * chunk (three and the engine load only when 3D is chosen), and the guard that hands a failing
 * 3D view back to 2D.
 */
import { lazy, Suspense } from "react";
import { useStrings } from "../../../lib/i18n";
import { ThreeGuard } from "../../knowledge/graph/scene3d";
import type { Plant3DProps } from "./Plant3DCanvas";

const Canvas = lazy(() => import("./Plant3DCanvas"));

let webgl2: boolean | undefined;
/** three draws with WebGL2 only (asked once; the test context is released). */
export function canDrawWebGL2() {
  if (webgl2 === undefined) {
    try {
      const gl = document.createElement("canvas").getContext("webgl2");
      webgl2 = !!gl;
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      webgl2 = false;
    }
  }
  return webgl2;
}

export function Plant3D(props: Plant3DProps) {
  const copy = useStrings().cad;
  return (
    <ThreeGuard onError={props.onLost}>
      <Suspense fallback={<div className="cad-3d cad-3d--loading" role="status">{copy.loading3d}</div>}>
        <Canvas {...props} />
      </Suspense>
    </ThreeGuard>
  );
}
