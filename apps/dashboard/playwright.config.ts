import { defineConfig, devices } from "@playwright/test";

const localBrowser = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env?.PLAYWRIGHT_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    // CI normally uses Playwright's pinned browser. A local installed browser can be
    // selected explicitly when the browser download is unavailable.
    launchOptions: localBrowser ? { executablePath: localBrowser } : undefined,
  },
  webServer: {
    command: "npm run demo",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
