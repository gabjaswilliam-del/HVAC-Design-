/**
 * CAD Studio's projects on the real local service, `apps/api/local_server.py`, started here on a
 * free port with a fresh data directory and CAD folder (never the user's own). The page uses its
 * same-origin path (`/api/cad/v1`), forwarded to that service as the dev server's proxy forwards
 * it in development (`?cad=local`). Needs Python 3.11 or later; skipped without it.
 */
import { expect, test, type Page } from "@playwright/test";

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
  const script = decodeURIComponent(new URL("apps/api/local_server.py", REPO).pathname).replace(/^\/([A-Za-z]:)/, "$1");
  proc = spawn(python, [script, "--port", String(port), "--data-dir", dataDir, "--cad-dir", `${dataDir}/cad`], { stdio: "pipe" }) as Proc;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the local service did not start:\n${log}`)), 20_000);
    proc!.stdout.on("data", (chunk) => {
      log += chunk.toString();
      if (log.includes("HVAC local API on")) {
        clearTimeout(timer);
        resolve();
      }
    });
    proc!.stderr.on("data", (c) => (log += c.toString()));
    proc!.on("exit", () => reject(new Error(`the local service exited:\n${log}`)));
  });
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
  for (const candidate of ["python", "py", "python3"]) {
    const r = spawnSync(candidate, ["-c", "import sys, sqlite3; assert sys.version_info >= (3, 11); print(sys.executable)"], { encoding: "utf-8" });
    if (r.status === 0) {
      python = String(r.stdout).trim();
      break;
    }
  }
  test.skip(!python, "the local service needs Python 3.11+");
  const { mkdtempSync } = await builtin("node:fs");
  const { tmpdir } = await builtin("node:os");
  const { join } = await builtin("node:path");
  const { createServer } = await builtin("node:net");
  dataDir = mkdtempSync(join(tmpdir(), "hvac-cad-"));
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
    (await builtin("node:fs")).rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  } catch (e) {
    console.warn(`left the test data in ${dataDir}: ${e}`);
  }
});

/** The page's same-origin CAD path goes to the service under test (uploads and downloads included). */
async function open(page: Page) {
  await page.route(/\/api\/cad\/v1\//, async (route) => {
    const url = new URL(route.request().url());
    let response;
    try {
      response = await route.fetch({ url: `http://127.0.0.1:${port}${url.pathname}${url.search}` });
    } catch {
      await route.abort("connectionrefused").catch(() => {});
      return;
    }
    await route.fulfill({ response }).catch(() => {});
  });
  await page.goto("/cad?cad=local");
  await expect(page.getByRole("heading", { name: /Projects/, level: 2 })).toBeVisible();
}
const toolbar = (page: Page) => page.locator(".cad-tb");
const inspector = (page: Page) => page.getByRole("complementary", { name: "Object inspector" });
const row = (page: Page, name: string) => page.locator(".cad-row", { hasText: name }).first();

/** A new project from the prepared sample, with one finding resolved, saved under `name`. */
async function saveReview(page: Page, name: string) {
  await row(page, "Water-cooled plant").click();
  const skip = page.getByRole("button", { name: "Skip" });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await inspector(page).getByRole("button", { name: /Unknown connection/ }).click();
  await page.getByRole("combobox", { name: "Evidence" }).selectOption("confirmed");
  await expect(toolbar(page).getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const prompt = page.getByRole("dialog", { name: "Save as" });
  await prompt.getByRole("textbox", { name: "Project name" }).fill(name);
  await prompt.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
  await expect(toolbar(page).getByText(/^Saved \d/)).toBeVisible();
}

test("a review saved to the local service comes back after a reload and a service restart", async ({ page }) => {
  await open(page);
  await expect(page.getByText("No saved projects")).toBeVisible();
  await saveReview(page, "Plant review A");

  // The divider is part of the saved view; moving it does not mark the project unsaved.
  const splitter = page.getByRole("separator", { name: "Resize comparison panels" });
  await splitter.press("ArrowRight");
  await expect(toolbar(page).getByText("Unsaved changes")).toHaveCount(0);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(toolbar(page).getByText(/^Saved \d/)).toBeVisible();

  for (const restart of [false, true]) {
    if (restart) {
      await stopService();
      await startService();
    }
    await page.reload();
    await expect(row(page, "Plant review A")).toContainText("1 open finding");
    await row(page, "Plant review A").click();
    await expect(page.getByRole("heading", { name: "Plant review A", level: 2 })).toBeVisible();
    // The saved selection comes back (the connection that was reviewed), then the findings.
    await expect(page.getByText("CW pump 4:discharge")).toBeVisible();
    await inspector(page).getByRole("button", { name: /Back to findings/ }).click();
    await expect(inspector(page).getByRole("button", { name: /Unknown connection/ })).toHaveCount(0);
    await expect(inspector(page).getByRole("button", { name: /Unconnected port/ })).toBeVisible();
    await expect(splitter).toHaveAttribute("aria-valuenow", "55");
  }
});

test("Save As, rename, duplicate and delete in the Project Library", async ({ page }) => {
  await open(page);
  await saveReview(page, "Plant review B");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("button", { name: "Save as…" }).click();
  const prompt = page.getByRole("dialog", { name: "Save as" });
  await prompt.getByRole("textbox", { name: "Project name" }).fill("Plant review C");
  await prompt.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Plant review C", level: 2 })).toBeVisible();

  await page.getByRole("button", { name: "Projects" }).click();
  const column = page.locator(".cad-library--column");
  await column.getByRole("button", { name: "Plant review C actions" }).click();
  await column.getByRole("button", { name: "Rename" }).click();
  const field = column.getByRole("textbox", { name: "Rename project" });
  await field.fill("Plant review D");
  await field.press("Enter");
  await expect(row(page, "Plant review D")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Plant review D", level: 2 })).toBeVisible();

  await column.getByRole("button", { name: "Plant review D actions" }).click();
  await column.getByRole("button", { name: "Duplicate" }).click();
  await expect(row(page, "Plant review D copy")).toBeVisible();

  await column.getByRole("button", { name: "Plant review D copy actions" }).click();
  await column.getByRole("button", { name: "Delete…" }).click();
  await expect(column.getByRole("alertdialog")).toContainText("Plant review D copy");
  await column.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(column.locator(".cad-row", { hasText: "Plant review D copy" })).toHaveCount(0);

  // Deleting the open project goes back to the Library.
  await column.getByRole("button", { name: "Plant review D actions" }).click();
  await column.getByRole("button", { name: "Delete…" }).click();
  await column.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("heading", { name: /Projects/, level: 2 })).toBeVisible();
  await expect(page.locator(".cad-row", { hasText: "Plant review D" })).toHaveCount(0);
  await expect(row(page, "Plant review B")).toBeVisible();
});

test("an uploaded drawing is stored as it is, downloads byte for byte, and is never parsed", async ({ page }) => {
  await open(page);
  const { createHash, randomBytes } = await builtin("node:crypto");
  const { Buffer } = await builtin("node:buffer");
  const bytes = Buffer.concat([Buffer.from("AC1032"), randomBytes(20_000)]);
  await page.locator('.cad-library input[type="file"]').setInputFiles({ name: "mech-room.dwg", mimeType: "application/octet-stream", buffer: bytes });
  await expect(page.getByRole("heading", { name: "mech-room.dwg", level: 3 })).toBeVisible();
  await expect(page.locator(".cad-file")).toContainText("Stored, not parsed");
  await expect(page.locator(".cad-file")).toContainText("No extraction");
  await expect(page.getByRole("radio", { name: "Compare" })).toHaveCount(0);

  // The link downloads the stored original (a routed request cannot become a browser download in
  // the test harness, so its address is fetched as the link would): exact bytes, as an attachment.
  const link = page.locator(".cad-file").getByRole("link", { name: "Download original" });
  await expect(link).toHaveAttribute("download", "mech-room.dwg");
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^\/api\/cad\/v1\/projects\/cadp_[0-9a-f]{16}\/original$/);
  const got = await page.evaluate(async (url) => {
    const r = await fetch(url!);
    return { type: r.headers.get("content-type"), disposition: r.headers.get("content-disposition"), bytes: Array.from(new Uint8Array(await r.arrayBuffer())) };
  }, href);
  expect(got.type).toBe("application/octet-stream");
  expect(got.disposition).toContain("attachment");
  expect(createHash("sha256").update(Buffer.from(got.bytes)).digest("hex")).toBe(createHash("sha256").update(bytes).digest("hex"));

  // A file that does not look like a drawing is refused, with the service's reason.
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("button", { name: "Close project" }).click();
  await page.locator('.cad-library input[type="file"]').setInputFiles({ name: "notes.dwg", mimeType: "application/octet-stream", buffer: Buffer.from("not a drawing") });
  await expect(page.locator(".cad-library").getByRole("alert")).toContainText("does not look like a DWG drawing");
});

test("a save from a stale tab is refused, and its work is kept as a copy", async ({ browser }) => {
  const a = await browser.newPage();
  const b = await browser.newPage();
  await open(a);
  await saveReview(a, "Shared review");
  await open(b);
  await row(b, "Shared review").click();
  await expect(b.getByRole("heading", { name: "Shared review", level: 2 })).toBeVisible();

  // A saves again; B, still at the older revision, then saves.
  await a.getByRole("separator", { name: "Resize comparison panels" }).press("ArrowLeft");
  await a.getByRole("button", { name: "Save", exact: true }).click();
  await expect(toolbar(a).getByText(/^Saved \d/)).toBeVisible();
  await inspector(b).getByRole("button", { name: /Back to findings/ }).click();
  await inspector(b).getByRole("button", { name: /Unconnected port/ }).click();
  await b.getByRole("combobox", { name: "Connect from" }).selectOption("chiller_plant_2");
  await b.getByRole("button", { name: "Create connection" }).click();
  await b.getByRole("button", { name: "Save", exact: true }).click();
  const notice = b.locator(".cad-notice");
  await expect(notice).toContainText("Saved elsewhere since this was opened");
  await notice.getByRole("button", { name: "Save a copy" }).click();
  await expect(b.getByRole("heading", { name: "Shared review copy", level: 2 })).toBeVisible();
  // The copy keeps B's work: the connection it created (still selected) closed the last finding.
  await expect(b.getByText("Chiller 2:evap_out")).toBeVisible();
  await inspector(b).getByRole("button", { name: /Back to findings/ }).click();
  await expect(inspector(b).getByText("No open findings")).toBeVisible();
  await a.close();
  await b.close();
});
