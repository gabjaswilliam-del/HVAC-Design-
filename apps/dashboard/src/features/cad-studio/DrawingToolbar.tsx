/**
 * The canvas's own controls, floating in its corners so the drawing keeps the whole area:
 * Select and Pan top left, the view's actions with Layers and the legend top right, and zoom
 * with Fit bottom right. Icons carry their names as tooltips and accessible labels.
 */
import { use, useRef, useState, type ReactNode } from "react";
import { Hand, Layers, Minus, MousePointer2, Plus, Scan, SwatchBook } from "lucide-react";
import { RadioGroup } from "../../components/RadioGroup";
import { useDismissOutside, useEscapeLayer } from "../../components/escape";
import { useStrings } from "../../lib/i18n";
import type { WorkspaceState } from "../../lib/contracts/cadProject";
import { ViewportContext, type DrawingTool } from "./ViewportContext";

interface DrawingToolbarProps {
  layers?: WorkspaceState["layers"];
  colourBy?: WorkspaceState["colourBy"];
  onLayer?: (layer: keyof WorkspaceState["layers"], value: boolean) => void;
  onColour?: (mode: WorkspaceState["colourBy"]) => void;
  /** The view's own actions (Review, the source drawing), first in the top-right cluster. */
  actions?: ReactNode;
  /** A note over the drawing, top centre (a read-only version, say). */
  banner?: ReactNode;
  legend?: ReactNode;
}

export function DrawingToolbar({ layers, colourBy, onLayer, onColour, actions, banner, legend }: DrawingToolbarProps) {
  const copy = useStrings().cad;
  const viewport = use(ViewportContext);
  if (!viewport) throw new Error("DrawingToolbar must be inside CadViewport");
  const [menu, setMenu] = useState<"layers" | "legend" | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEscapeLayer(menu !== null, () => setMenu(null));
  useDismissOutside(menu !== null, box, () => setMenu(null));
  const zoomPercent = Math.round(viewport.zoomLevel * 100);
  const toggle = (next: "layers" | "legend") => setMenu(menu === next ? null : next);

  return (
    <>
      <div className="cad-float cad-float--tl" role="toolbar" aria-label={copy.drawingTools}>
        <RadioGroup<DrawingTool>
          label={copy.interactionMode}
          value={viewport.tool}
          options={[
            { value: "select", label: <MousePointer2 size={15} aria-hidden="true" />, name: copy.selectTool, title: copy.selectTool },
            { value: "pan", label: <Hand size={15} aria-hidden="true" />, name: copy.panTool, title: copy.panTool },
          ]}
          onChange={viewport.setTool}
        />
      </div>
      {banner && <div className="cad-float cad-float--tc">{banner}</div>}
      <div ref={box} className="cad-float cad-float--tr">
        {actions}
        {layers && onLayer && (
          <button type="button" className="cad-chip-button" aria-haspopup="true" aria-expanded={menu === "layers"} aria-controls="cad-layers-menu" onClick={() => toggle("layers")} title={copy.layers}>
            <Layers size={15} aria-hidden="true" /><span className="visually-hidden">{copy.layers}</span>
          </button>
        )}
        {(legend || layers) && (
          <button type="button" className="cad-chip-button" aria-haspopup="true" aria-expanded={menu === "legend"} aria-controls="cad-legend-menu" onClick={() => toggle("legend")} title={copy.legend}>
            <SwatchBook size={15} aria-hidden="true" /><span className="visually-hidden">{copy.legend}</span>
          </button>
        )}
        {menu === "layers" && layers && onLayer && (
          <fieldset id="cad-layers-menu" className="cad-popover">
            <legend>{copy.layers}</legend>
            {(Object.keys(copy.layerNames) as (keyof WorkspaceState["layers"])[]).map((layer) => (
              <label key={layer} className="cad-check"><input type="checkbox" checked={layers[layer]} onChange={(event) => onLayer(layer, event.target.checked)} />{copy.layerNames[layer]}</label>
            ))}
            {colourBy && onColour && (
              <RadioGroup<WorkspaceState["colourBy"]>
                label={copy.colourBy}
                value={colourBy}
                options={[{ value: "medium", label: copy.colourMedium }, { value: "review", label: copy.colourReview }]}
                onChange={onColour}
              />
            )}
          </fieldset>
        )}
        {menu === "legend" && (
          <div id="cad-legend-menu" className="cad-popover cad-popover--legend" role="group" aria-label={copy.legend}>
            {legend ?? <MediaLegend />}
          </div>
        )}
      </div>
      <div className="cad-float cad-float--br" role="group" aria-label={copy.zoomControls}>
        <button type="button" className="cad-chip-button" onClick={viewport.zoomOut} aria-label={copy.zoomOut} title={copy.zoomOut}><Minus size={15} aria-hidden="true" /></button>
        <output className="cad-zoom-level" role="status" aria-label={`${copy.zoomLevel} ${zoomPercent}%`}>{zoomPercent}%</output>
        <button type="button" className="cad-chip-button" onClick={viewport.zoomIn} aria-label={copy.zoomIn} title={copy.zoomIn}><Plus size={15} aria-hidden="true" /></button>
        <button type="button" className="cad-chip-button" onClick={viewport.fit} aria-label={copy.fitDrawing} title={copy.fitDrawing}><Scan size={15} aria-hidden="true" /></button>
      </div>
    </>
  );
}

/** Pipe media and review states, as drawn on the sheet. */
export function MediaLegend() {
  const copy = useStrings().cad;
  return (
    <>
      {Object.entries(copy.headerNames).map(([id, label]) => (
        <span key={id} className="cad-legend__item"><i className={`cad-swatch cad-swatch--${id === "cw_supply" ? "cw-cool" : id === "cw_return" ? "cw-hot" : id.replace("_", "-")}`} aria-hidden="true" />{label}</span>
      ))}
      {(["confirmed", "review", "unknown"] as const).map((status) => (
        <span key={status} className="cad-legend__item"><i className={`cad-swatch cad-swatch--state is-${status}`} aria-hidden="true" />{copy.reviewStates[status]}</span>
      ))}
    </>
  );
}
