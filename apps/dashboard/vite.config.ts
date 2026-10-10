import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Only index.html is built. asset-sheet.html is a development-only artwork review page
// that the dev server serves from the project root.
// Development only: the Knowledge workspace's local services (`knowledge=local`) are
// same-origin paths proxied to the local API, `python apps/api/local_server.py` on its
// default port. Nothing else under /api is proxied.
const localApi = "http://127.0.0.1:8765";
export default defineConfig({
  plugins: [react()],
  // The 3D knowledge graph draws with WebGL only; `three/webgpu` (imported by
  // three-render-objects for an option the app never sets) is replaced by a stand-in,
  // which keeps about 600 kB out of the 3D chunk. The dev server's dependency pre-bundling
  // cannot resolve a root-relative alias from inside node_modules, so it leaves that
  // import to the normal resolver.
  resolve: { alias: { "three/webgpu": "/src/features/knowledge/graph/noWebgpu.ts" } },
  optimizeDeps: { exclude: ["three/webgpu"] },
  server: { port: 5173, strictPort: true, proxy: { "/api/knowledge": localApi, "/api/memory": localApi } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
