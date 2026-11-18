import { createContext } from "react";

export type DrawingTool = "select" | "pan";
export interface ViewportControls {
  zoomLevel: number;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  tool: DrawingTool;
  setTool: (tool: DrawingTool) => void;
}

export const ViewportContext = createContext<ViewportControls | null>(null);
