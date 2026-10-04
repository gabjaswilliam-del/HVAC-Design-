import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Only index.html is built. asset-sheet.html is a development-only artwork review page
// that the dev server serves from the project root.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
