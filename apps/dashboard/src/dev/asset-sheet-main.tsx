import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/base.css";
import { AssetSheet } from "./AssetSheet";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AssetSheet />
  </StrictMode>,
);
