/** The Overview's AI display: what the assistant shows (the `show_on_display` tool). */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const aiDisplay = (page: Page) => page.locator(".ai-display");
const t = (min: number) => new Date(Date.UTC(2026, 8, 27, 16) + min * 60_000).toISOString();
const item = (id: string, title: string, content: unknown) => ({
  id,
  title,
  caption: `${title}, for the test.`,
  content,
  shownAt: t(900),
  source: { kind: "assistant", conversationId: null, demo: true },
});
// A 1x1 PNG.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const ITEMS = [
  item("d-line", "Plant power today", { kind: "line", unit: "kW", series: [{ label: "Plant power", points: [0, 60, 120].map((m, i) => ({ t: t(m), v: 300 + i * 10 })) }] }),
  item("d-bar", "Load by equipment", { kind: "bar", unit: "kW", bars: [{ label: "Chiller 1", value: 210 }, { label: "CW pump 2", value: 32.5 }] }),
  item("d-table", "Open issues", { kind: "table", columns: [{ key: "id", label: "Issue" }, { key: "kw", label: "Unmet (kWt)", align: "end" }], rows: [{ id: "ISS-1", kw: 120 }] }),
  item("d-stats", "Headline figures", { kind: "stats", items: [{ label: "System COP", value: "4.12" }] }),
  item("d-image", "A drawn chart", { kind: "image", src: PNG, alt: "A chart the assistant drew" }),
  item("d-html", "A page it wrote", { kind: "html", html: "<h1>Hello</h1><script>document.body.dataset.ran = '1'</script>", height: 200 }),
];

async function seed(page: Page, items = ITEMS, shownId = "d-html") {
  await page.addInitScript(([key, value]) => sessionStorage.setItem(key, value), ["hvac-agent.ai-display.v1", JSON.stringify({ items, shownId })] as const);
}

test("with nothing queried it says so and offers the assistant", async ({ page }) => {
  await page.goto("/?view=display");
  await expect(page.getByRole("radio", { name: "AI display" })).toHaveAttribute("aria-checked", "true");
  await expect(aiDisplay(page)).toContainText("Nothing on the AI display yet");
  await expect(aiDisplay(page)).toContainText("Nothing has been queried");
  await aiDisplay(page).getByRole("button", { name: "Ask the assistant" }).click();
  await expect(page.getByRole("complementary", { name: "AI assistant" })).toBeVisible();
});

test("a page the assistant wrote runs sandboxed, with no access to the dashboard", async ({ page }) => {
  await seed(page);
  await page.goto("/?view=display");
  await expect(aiDisplay(page).getByRole("heading", { level: 2 })).toHaveText("A page it wrote");
  const frame = aiDisplay(page).locator("iframe");
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  await expect(frame).toHaveAttribute("title", /shown sandboxed/);
  await expect(page.frameLocator(".ai-display iframe").getByRole("heading", { name: "Hello" })).toBeVisible();
  // Its own script ran inside the frame; the dashboard's document is untouched.
  expect(await page.evaluate(() => document.body.dataset.ran)).toBeUndefined();
});

test("each kind of content is drawn, and earlier items are one step away", async ({ page }) => {
  await seed(page);
  await page.goto("/?view=display");
  const earlier = aiDisplay(page).getByLabel("Shown earlier");
  await earlier.selectOption("d-image");
  await expect(aiDisplay(page).getByRole("img", { name: "A chart the assistant drew" })).toBeVisible();
  await earlier.selectOption("d-stats");
  await expect(aiDisplay(page).locator(".ai-display__stat")).toContainText("4.12");
  await earlier.selectOption("d-table");
  await expect(aiDisplay(page).getByRole("cell", { name: "ISS-1" })).toBeVisible();
  await earlier.selectOption("d-bar");
  await expect(aiDisplay(page).getByRole("figure", { name: "Load by equipment" })).toContainText("32.5 kW");
  await earlier.selectOption("d-line");
  await expect(aiDisplay(page).getByRole("img", { name: /Plant power today/ })).toBeVisible();
  await expect(aiDisplay(page)).toContainText("Plant power today, for the test.");
  await expect(aiDisplay(page)).toContainText("Demo data");

  await aiDisplay(page).getByRole("button", { name: "Clear" }).click();
  await expect(aiDisplay(page)).toContainText("Nothing on the AI display yet");
});

test("no serious accessibility violations on the AI display", async ({ page }) => {
  await seed(page, ITEMS, "d-line");
  await page.goto("/?view=display");
  await expect(aiDisplay(page).getByRole("img", { name: /Plant power today/ })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
});
