/**
 * M7: the Knowledge workspace on the real local services, `apps/api/local_server.py`: a
 * persistent document library and memory in SQLite, started here on a free port with a
 * fresh data directory. The page uses its same-origin paths (`/api/knowledge/v1`,
 * `/api/memory/v1`), forwarded to that service as the dev server's proxy forwards them in
 * development (`?knowledge=local`). Needs Python 3.11 or later; skipped without it.
 */
import { expect, test, type Page } from "@playwright/test";

// The project has no Node type definitions; the few built-ins used here load untyped.
interface Proc {
  stdout: { on(event: "data", cb: (chunk: { toString(): string }) => void): void };
  stderr: { on(event: "data", cb: (chunk: { toString(): string }) => void): void };
  on(event: "exit", cb: () => void): void;
  kill(): boolean;
  exitCode: number | null;
}
const builtin = (name: string): Promise<any> => import(name); // eslint-disable-line @typescript-eslint/no-explicit-any

const REPO = new URL("../../../", import.meta.url);
let python: string | null = null;
let port = 0;
let dataDir = "";
let proc: Proc | null = null;
let log = "";

async function startService() {
  const { spawn } = await builtin("node:child_process");
  const script = new URL("apps/api/local_server.py", REPO);
  proc = spawn(python, [decodeURIComponent(script.pathname).replace(/^\/([A-Za-z]:)/, "$1"), "--port", String(port), "--data-dir", dataDir], { stdio: "pipe" }) as Proc;
  const started = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the local service did not start:\n${log}`)), 20_000);
    const seen = (chunk: { toString(): string }) => {
      log += chunk.toString();
      if (log.includes("HVAC local API on")) {
        clearTimeout(timer);
        resolve();
      }
    };
    proc!.stdout.on("data", seen);
    proc!.stderr.on("data", (c) => (log += c.toString()));
    proc!.on("exit", () => reject(new Error(`the local service exited:\n${log}`)));
  });
  await started;
}
async function stopService() {
  if (!proc || proc.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => proc!.on("exit", resolve));
  proc.kill();
  await exited;
  proc = null;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const { spawnSync } = await builtin("node:child_process");
  // The interpreter itself, not a launcher (on Windows `python` may be an alias that starts
  // it as a child), so stopping the service really stops it and releases its files.
  for (const candidate of ["python", "py", "python3"]) {
    const r = spawnSync(candidate, ["-c", "import sys, sqlite3; assert sys.version_info >= (3, 11); sqlite3.connect(':memory:').execute('create virtual table t using fts5(x)'); print(sys.executable)"], { encoding: "utf-8" });
    if (r.status === 0) {
      python = String(r.stdout).trim();
      break;
    }
  }
  test.skip(!python, "the local service needs Python 3.11+ with SQLite FTS5");
  const { mkdtempSync } = await builtin("node:fs");
  const { tmpdir } = await builtin("node:os");
  const { join } = await builtin("node:path");
  const { createServer } = await builtin("node:net");
  dataDir = mkdtempSync(join(tmpdir(), "hvac-m7-"));
  port = await new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  await startService();
});

test.afterAll(async () => {
  await stopService();
  if (!dataDir) return;
  try {
    // Windows releases a stopped process's files a moment after it exits.
    (await builtin("node:fs")).rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  } catch (e) {
    console.warn(`left the test data in ${dataDir}: ${e}`);
  }
});

/** The page's same-origin service paths go to the service under test. */
async function connect(page: Page) {
  await page.route(/\/api\/(knowledge|memory)\/v1\//, async (route) => {
    const url = new URL(route.request().url());
    let response;
    try {
      response = await route.fetch({ url: `http://127.0.0.1:${port}${url.pathname}${url.search}` });
    } catch {
      // The service is down (or the page went away): the browser sees a refused connection.
      await route.abort("connectionrefused").catch(() => {});
      return;
    }
    await route.fulfill({ response }).catch(() => {}); // the page may have moved on
  });
}
async function open(page: Page, query = "") {
  await connect(page);
  await page.goto(`/knowledge?knowledge=local${query}`);
  await expect(page.getByRole("heading", { level: 1, name: "Knowledge" })).toBeVisible();
  // The heading is the app's, there before the workspace has loaded: wait for the workspace.
  await expect(page.getByRole("tablist", { name: "Knowledge systems" })).toBeVisible();
}
const panel = (page: Page) => page.locator(".kn-panel");
/** The graph's one search box: a node by name, or the passages for the words typed. */
const searchBox = (page: Page) => page.getByRole("combobox", { name: "Search nodes and passages" });
// Form and action errors (the app keeps its own hidden live region as well).
const md = (text: string) => Buffer.from(text, "utf-8");
declare const Buffer: { from(text: string, encoding: string): Uint8Array };

const NOTES = `# Chiller 2 field notes

These notes are test data for the local knowledge service.

## Condenser checks

Condenser tube fouling raises the condenser approach and causes low COP on Chiller 2.
CW pump 2 feeds Chiller 2.
`;

async function upload(page: Page, name: string, text: string, opts: { title?: string; equipment?: string } = {}) {
  await page.getByRole("button", { name: "Add document" }).click();
  const form = page.locator(".kn-form");
  await form.locator('input[type="file"]').setInputFiles({ name, mimeType: "application/octet-stream", buffer: md(text) as never });
  if (opts.title) await form.getByLabel("Title (optional)").fill(opts.title);
  if (opts.equipment) await form.getByLabel("Equipment IDs (optional)").fill(opts.equipment);
  await form.getByRole("button", { name: "Add to library" }).click();
}

test("real mode shows the local service: empty, persistent, and plain about what it cannot do", async ({ page }) => {
  await open(page);
  // The graph says it is empty; the library, opened beside it, says why.
  await expect(page.getByText("The graph is empty: no document has been indexed yet.")).toBeVisible();
  await page.getByRole("button", { name: "Library" }).click();
  await expect(page.getByText("Local knowledge service", { exact: true })).toBeVisible();
  await expect(page.getByText("The library is empty. Add a manual, procedure or reference to index it.")).toBeVisible();
  const caps = page.locator(".kn-caps");
  await expect(caps).toContainText("SQLite, persistent on this machine");
  await expect(caps).toContainText("PDF not configured");
  await expect(caps.locator("div", { hasText: "Vector search" })).toContainText("Not configured");
  await expect(page.getByText(/demo library is fixed/)).toHaveCount(0);
});

test("uploads are checked before they are sent", async ({ page }) => {
  await open(page, "&kv=library");
  await upload(page, "tool.exe", "MZ");
  await expect(page.locator(".kn-error")).toContainText(".exe files are not supported here");
  await page.locator(".kn-form").locator('input[type="file"]').setInputFiles({ name: "empty.md", mimeType: "text/markdown", buffer: md("") as never });
  await page.getByRole("button", { name: "Add to library" }).click();
  await expect(page.locator(".kn-error")).toContainText("The file is empty.");
  await page.getByRole("button", { name: "Cancel" }).click();
  // Escape puts the form away, not the library.
  await page.getByRole("button", { name: "Add document" }).click();
  await expect(page.locator(".kn-form")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".kn-form")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Document library" })).toBeVisible();
});

test("a document is queued, processed in stages and indexed, then found by search with its graph path", async ({ page }) => {
  await open(page, "&kv=library");
  await upload(page, "chiller-2-notes.md", NOTES, { equipment: "chiller_plant_2" });
  await expect(panel(page).getByRole("heading", { name: "Chiller 2 field notes" })).toBeVisible();
  await expect(panel(page).locator(".kn-status")).toHaveText(/Queued|Processing|Indexed/);
  await expect(panel(page).locator(".kn-status")).toHaveText("Indexed", { timeout: 15_000 });
  const stages = panel(page).locator(".kn-stage");
  await expect(stages).toHaveCount(8);
  await expect(stages.filter({ hasText: "Failed" })).toHaveCount(0);
  await expect(panel(page)).toContainText("Chiller 2");
  await expect(page.locator(".kn-docs tbody tr")).toHaveCount(1);
  // The new document is its own group in the graph, focused beside it.
  const id = /doc=(doc_\w+)/.exec(page.url())![1];
  await expect(page.locator(`.kn-3d__label[data-node-id="${id}"]`)).toBeAttached();
  await expect(page.getByRole("application", { name: /Knowledge graph/ })).toHaveAttribute("data-group", id);

  // The search box: a question names no node, so its one choice is the passages.
  await searchBox(page).fill("What causes low COP on Chiller 2?");
  await searchBox(page).press("Enter");
  const top = page.locator(".kn-hit").first();
  await expect(top).toContainText("Chiller 2 field notes");
  await expect(top.locator(".kn-method")).toContainText(["Keyword #", "Graph #"]);
  await top.getByRole("button", { name: "Read passage" }).click();
  await expect(panel(page).locator(".kn-passage")).toContainText("Condenser tube fouling raises the condenser approach");
});

test("a duplicate is refused, with the way to the document already there", async ({ page }) => {
  await open(page, "&kv=library");
  await upload(page, "copy-of-notes.md", NOTES);
  await expect(page.locator(".kn-error")).toContainText("already in the library");
  await page.getByRole("button", { name: "Open the document" }).click();
  await expect(panel(page).getByRole("heading", { name: "Chiller 2 field notes" })).toBeVisible();
});

test("a document with no text fails at extraction, visibly", async ({ page }) => {
  await open(page, "&kv=library");
  await upload(page, "drawings.md", "<div><img src='sheet-1.png'></div>", { title: "Drawing register" });
  await expect(panel(page).locator(".kn-status")).toHaveText("Failed", { timeout: 15_000 });
  await expect(panel(page).locator(".kn-stage", { hasText: "Text extraction" })).toContainText("Failed");
  await expect(panel(page)).toContainText("The file has no text to index.");
  await expect(page.locator(".kn-docs tr", { hasText: "Drawing register" })).toContainText("Failed");
});

test("the graph's relationships show the uploaded text that supports them", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("application", { name: /Knowledge graph, \d+ nodes/ })).toBeVisible();
  await searchBox(page).fill("Condenser tube fou");
  await page.getByRole("listbox", { name: "Matches" }).getByRole("option").filter({ hasText: "Condenser tube fouling" }).click();
  await panel(page).getByRole("button", { name: /is associated with/ }).first().click();
  await expect(panel(page).locator(".kn-snippet").first()).toContainText("Condenser tube fouling raises the condenser approach and causes low COP on Chiller 2.");
  await expect(panel(page)).toContainText("Chiller 2 field notes");
});

test("memory: what may be stored, recording, linking, correcting with history, and deleting", async ({ page }) => {
  await open(page, "&kn=memory");
  await expect(page.getByText("Local memory service", { exact: true })).toBeVisible();
  await expect(page.getByText("No memory record matches these filters.")).toBeVisible();
  await page.getByRole("button", { name: "Record memory" }).click();
  const form = page.locator(".kn-form");
  // The persistent store offers only what it accepts.
  const provenance = form.getByLabel("Provenance");
  await expect(provenance.locator("option")).toHaveText(["Simulation", "User-entered", "Imported record"]);
  await form.getByRole("button", { name: "Save record" }).click();
  await expect(page.locator(".kn-error")).toContainText("A title is required.");
  await form.getByLabel("Title").fill("Chiller 2 condenser approach 4.8 K");
  await form.getByLabel("Happened at (UTC)").fill("2099-01-01T00:00");
  await form.getByRole("button", { name: "Save record" }).click();
  await expect(page.locator(".kn-error")).toContainText("It cannot have happened in the future.");
  await form.getByLabel("Happened at (UTC)").fill("2026-10-07T08:00");
  await form.getByLabel("Equipment IDs").fill("chiller_plant_2");
  await form.getByLabel("Notes (optional)").fill("password: hunter2");
  await form.getByRole("button", { name: "Save record" }).click();
  await expect(page.locator(".kn-error")).toContainText("looks like it contains a credential");
  await form.getByLabel("Notes (optional)").fill("Logged on the morning round.");
  await form.getByRole("button", { name: "Save record" }).click();
  await expect(panel(page).getByRole("heading", { name: "Chiller 2 condenser approach 4.8 K" })).toBeVisible();
  await expect(panel(page)).toContainText("User-entered");

  // A finding supported by the observation.
  await page.getByRole("button", { name: "Record memory" }).click();
  await form.getByLabel("Kind").selectOption("finding");
  await form.getByLabel("Title").fill("Condenser fouling suspected on Chiller 2");
  await form.getByLabel("Happened at (UTC)").fill("2026-10-07T09:00");
  await form.getByLabel("Link (optional)").selectOption("SUPPORTED_BY:out");
  await form.getByLabel("Linked record").selectOption({ label: "Observation: Chiller 2 condenser approach 4.8 K" });
  await form.getByRole("button", { name: "Save record" }).click();
  await expect(panel(page).getByRole("heading", { name: "Condenser fouling suspected on Chiller 2" })).toBeVisible();
  await expect(panel(page).locator(".kn-rels")).toContainText("Supported by");

  // Correct the observation: a new version; the old one stays as history.
  await page.locator(".kn-entry", { hasText: "Chiller 2 condenser approach 4.8 K" }).click();
  await panel(page).getByRole("button", { name: "Correct…" }).click();
  await panel(page).getByLabel("Reason").fill("Sensor read 0.6 K low");
  await panel(page).getByLabel("Title").fill("Chiller 2 condenser approach 4.2 K");
  await panel(page).getByRole("button", { name: "Save correction" }).click();
  await expect(panel(page).getByRole("heading", { name: "Chiller 2 condenser approach 4.2 K" })).toBeVisible();
  await expect(panel(page).locator(".kn-history li")).toHaveCount(2);
  await expect(panel(page)).toContainText("Reason: Sensor read 0.6 K low");
  await page.getByRole("checkbox", { name: "Include superseded versions" }).check();
  await expect(page.locator(".kn-entry--old")).toContainText("Chiller 2 condenser approach 4.8 K");

  // Delete the correction: confirmed first; the version it corrected is current again.
  await panel(page).getByRole("button", { name: "Delete…" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("becomes current again");
  await page.getByRole("button", { name: "Delete record" }).click();
  await expect(panel(page)).toContainText("The version it corrected is current again.");
  await panel(page).getByRole("button", { name: "Open the restored version" }).click();
  await expect(panel(page).getByRole("heading", { name: "Chiller 2 condenser approach 4.8 K" })).toBeVisible();
  await expect(panel(page)).toContainText("Current");
});

test("a removed document takes its passages, keyword entries and relationships with it", async ({ page }) => {
  await open(page, "&kv=library");
  await page.locator(".kn-docs").getByRole("button", { name: "Chiller 2 field notes" }).click();
  await panel(page).getByRole("button", { name: "Remove…" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Remove “Chiller 2 field notes”?");
  await page.getByRole("button", { name: "Remove document" }).click();
  await expect(panel(page)).toContainText(/Removed the stored file, its \d+ passages/);
  await expect(page.locator(".kn-docs tr", { hasText: "Chiller 2 field notes" })).toHaveCount(0);
  await page.goto(`/knowledge?knowledge=local&kv=search&q=${encodeURIComponent("condenser tube fouling")}`);
  await expect(page.getByText(/No indexed passage matches/)).toBeVisible();
});

test("documents and memory survive a reload and a restart of the service", async ({ page }) => {
  await open(page, "&kv=library");
  await upload(page, "chiller-2-notes.md", NOTES);
  await expect(panel(page).locator(".kn-status")).toHaveText("Indexed", { timeout: 15_000 });
  await page.reload();
  await expect(page.locator(".kn-docs tr", { hasText: "Chiller 2 field notes" })).toContainText("Indexed");
  await stopService();
  await startService();
  await page.reload();
  await expect(page.locator(".kn-docs tr", { hasText: "Chiller 2 field notes" })).toContainText("Indexed");
  await expect(page.locator(".kn-docs tr", { hasText: "Drawing register" })).toContainText("Failed");
  await page.goto("/knowledge?knowledge=local&kn=memory");
  await expect(page.locator(".kn-entry", { hasText: "Condenser fouling suspected on Chiller 2" })).toBeVisible();
});

test("with the service stopped, real mode says so and never shows demo data", async ({ page }) => {
  await stopService();
  await open(page, "&kv=library");
  await expect(page.getByRole("alert").filter({ hasText: "The library could not be loaded." })).toContainText("could not be reached");
  await expect(page.getByRole("alert").filter({ hasText: "The knowledge graph could not be loaded." })).toBeVisible();
  await expect(page.getByText("Demo chiller maintenance guide")).toHaveCount(0);
  await page.goto("/knowledge?knowledge=local&kn=memory");
  await expect(page.getByRole("alert").filter({ hasText: "Memory could not be loaded." })).toBeVisible();
  await expect(page.getByText("Chiller 2 tripped on high head pressure")).toHaveCount(0);
  await startService();
});
