import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const ROUTES: [string, string][] = [
  ["/", "Monitoring"],
  ["/equipment", "Equipment"],
  ["/prediction", "Cooling prediction"],
  ["/agent", "AI assistant"],
  ["/simulation", "Simulation"],
  ["/pilot", "AI pilot"],
  ["/cad", "CAD Studio"],
  ["/knowledge", "Knowledge base"],
  ["/setup", "Installation"],
  ["/system", "System"],
];

test("every navigation item opens its screen and moves focus to the heading", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  for (const [path, name] of ROUTES.slice(1).concat([ROUTES[0]])) {
    await nav.getByRole("link", { name }).click();
    await expect(page).toHaveURL(path);
    const heading = page.getByRole("heading", { level: 1, name });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(page.getByText("Demo data", { exact: true })).toBeVisible();
  }
});

test("unknown address explains itself", async ({ page }) => {
  await page.goto("/no-such-screen");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
});

test("narrow screens use a navigation drawer and keep the data mode visible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("Demo data", { exact: true })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav).toBeHidden();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await nav.getByRole("link", { name: "Simulation" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Simulation" })).toBeVisible();
  await expect(nav).toBeHidden();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test("bundled font loads and readings use tabular figures", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() => document.fonts.check('600 16px "Barlow Semi Condensed"'));
  expect(loaded).toBe(true);
  // Proportional digits differ in width; with `.num` (tabular-nums) they must not.
  const widths = (tabular: boolean) =>
    page.evaluate((tabular) => {
      const span = document.createElement("span");
      if (tabular) span.className = "num";
      Object.assign(span.style, {
        fontFamily: "'Barlow Semi Condensed'",
        fontWeight: "600",
        fontSize: "16px",
        position: "absolute",
      });
      document.body.append(span);
      const measure = (t: string) => ((span.textContent = t), span.getBoundingClientRect().width.toFixed(2));
      const result = [measure("1111.1"), measure("0000.0"), measure("8888.8")];
      span.remove();
      return result;
    }, tabular);
  expect(new Set(await widths(false)).size).toBeGreaterThan(1);
  expect(new Set(await widths(true)).size).toBe(1);
});

for (const [path] of [ROUTES[0], ROUTES[1]]) {
  test(`no serious accessibility violations on ${path}`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}
