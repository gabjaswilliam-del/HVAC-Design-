import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { settled } from "./pilot-console";

// Every screen, and how the navigation reaches it (F3): primary sections in the dock,
// the System menu at its foot, and the workspace for the assistant and pilot pages.
// The page name is the top bar's h1.
type Step = (page: Page) => Promise<void>;
const nav = (page: Page) => page.getByRole("navigation", { name: "Main navigation" });
const dock = (name: string): Step => (page) => nav(page).getByRole("link", { name, exact: true }).click();
const systemMenu = (name: string): Step => async (page) => {
  await nav(page).getByRole("button", { name: "System", exact: true }).click();
  await page.getByRole("group", { name: "System and installation" }).getByRole("link", { name }).click();
};
const ROUTES: [string, string, Step][] = [
  ["/prediction", "Cooling prediction", dock("Analytics")],
  ["/engineering", "Engineering", dock("Engineering")],
  ["/cad", "CAD Studio", dock("CAD Studio")],
  ["/simulation", "Simulation history", async (page) => {
    await dock("Engineering")(page);
    await page.locator("#hub-simulation").getByRole("link", { name: "Open Simulation history" }).click();
  }],
  ["/knowledge", "Knowledge", dock("Knowledge")],
  ["/system", "System", systemMenu("System")],
  ["/setup", "Installation", systemMenu("Installation")],
  ["/agent", "AI assistant", async (page) => {
    await page.getByRole("tab", { name: "Assistant" }).click();
    await page.getByRole("link", { name: "Open full page" }).click();
  }],
  ["/", "Overview", dock("Overview")],
];

test("every screen is reachable from the navigation and moves focus to its heading", async ({ page }) => {
  await page.goto("/");
  for (const [path, name, go] of ROUTES) {
    await go(page);
    await expect(page).toHaveURL(path);
    const heading = page.getByRole("heading", { level: 1, name });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(page.getByText("Demo data", { exact: true })).toBeVisible();
    // Each screen has its own page title.
    await expect(page).toHaveTitle(new RegExp(`HVAC Agent · ${name}$`));
  }
});

test("the top bar reads as one location: site / page", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".site")).toHaveText("Synthetic demo plant/Overview");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Overview");
});

test("no scenario switch outside AI Pilot: the deck keeps the source, playback and the clock; a demo scenario comes with the address", async ({ page }) => {
  await page.goto("/?scenario=tower-fault");
  const deck = page.getByRole("contentinfo", { name: "Data source and time" });
  await expect(deck.getByRole("radiogroup", { name: "Data source" })).toBeVisible();
  await expect(deck.getByRole("slider", { name: "Time of day" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Demo scenario" })).toHaveCount(0);
  await expect(deck.getByRole("option", { name: "Cooling tower 4 fan fault" })).toHaveCount(0);
  // The deterministic scenarios stay: the address's scenario drives the demo telemetry.
  await expect(page.locator(".attention")).toContainText("Cooling tower 4 fan fault");
  await page.goto("/?scenario=normal");
  await expect(page.locator(".attention")).toContainText("No open issues");
});

test("the dock marks the current section; /simulation, /trend and /cad open their own screens", async ({ page }) => {
  // M6: Simulation history is its own screen inside the Engineering section.
  await page.goto("/simulation");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Simulation history");
  await expect(nav(page).getByRole("link", { name: "Engineering", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(nav(page).getByRole("link", { name: "Overview", exact: true })).not.toHaveAttribute("aria-current", "page");
  // An indicator's trend, the workspace's answer to "show me COP", belongs to Analytics.
  await page.goto("/trend?metric=plant:cop");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Trend");
  await expect(nav(page).getByRole("link", { name: "Analytics", exact: true })).toHaveAttribute("aria-current", "page");
  await page.goto("/cad");
  await expect(nav(page).getByRole("link", { name: "CAD Studio", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("CAD Studio");
  await expect(page.getByRole("button", { name: /Water-cooled plant/i })).toBeVisible();
});

test("the dock is one tab stop; arrow keys move between its items", async ({ page }) => {
  await page.goto("/");
  const overview = nav(page).getByRole("link", { name: "Overview", exact: true });
  await overview.focus();
  await expect(nav(page).locator('[tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  await expect(nav(page).getByRole("link", { name: "Analytics", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(nav(page).getByRole("button", { name: "System", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("group", { name: "System and installation" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: "System and installation" })).toBeHidden();
  await expect(nav(page).getByRole("button", { name: "System", exact: true })).toBeFocused();
});

test("single-key shortcuts navigate, fit, switch the view and cycle readings; ? lists them", async ({ page }) => {
  await page.goto("/?scenario=tower-fault");
  await expect(page.locator(".plant-view")).toBeVisible();
  await page.locator("body").press("2");
  await expect(page).toHaveURL(/\/prediction/);
  await page.locator("body").press("3");
  await expect(page).toHaveURL(/\/engineering/);
  await page.locator("body").press("1");
  await expect(page.locator(".plant-view")).toBeVisible();

  // L: list and back. R: readings, from Auto (key at this fit) to all, off, key.
  await page.keyboard.press("l");
  await expect(page.getByRole("radio", { name: "Equipment list" })).toHaveAttribute("aria-checked", "true");
  await expect(page).toHaveURL(/view=list/);
  await page.keyboard.press("l");
  await expect(page.locator(".plant-view")).toHaveAttribute("data-read", "key");
  await page.keyboard.press("r");
  await expect(page.locator(".plant-view")).toHaveAttribute("data-read", "all");
  await page.keyboard.press("r");
  await expect(page.locator(".plant-view")).toHaveAttribute("data-read", "off");
  await page.keyboard.press("r");
  await expect(page.locator(".plant-view")).toHaveAttribute("data-read", "key");

  // F refits after a zoom.
  const fit = await page.locator(".plant-view").getAttribute("data-zoom");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.locator("body").press("f");
  await expect(page.locator(".plant-view")).toHaveAttribute("data-zoom", fit!);

  // ? lists the shortcuts; Escape closes the list.
  await page.keyboard.press("?");
  const list = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(list).toBeVisible();
  await expect(list.getByText("Next open issue")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
});

test("shortcuts never fire while typing; / asks the assistant", async ({ page }) => {
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "Question for the assistant" });
  await expect(composer).toBeVisible();
  await page.locator("body").press("/");
  await expect(composer).toBeFocused();
  await page.keyboard.type("12 lfr");
  await expect(composer).toHaveValue("12 lfr");
  await expect(page).toHaveURL(/\/$|\/\?/);
  await expect(page.locator(".plant-view")).toHaveAttribute("data-read", "key");
});

test("the deck's data source is a radio group operated with arrow keys", async ({ page }) => {
  await page.goto("/");
  const source = page.getByRole("radiogroup", { name: "Data source" });
  await source.getByRole("radio", { name: "Replay" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(source.getByRole("radio", { name: "Live demo" })).toHaveAttribute("aria-checked", "true");
  await expect(source.getByRole("radio", { name: "Live demo" })).toBeFocused();
  await expect(page.getByRole("slider", { name: "Time of day" })).toBeDisabled();
  await page.keyboard.press("ArrowRight");
  await expect(source.getByRole("radio", { name: "Replay" })).toHaveAttribute("aria-checked", "true");
});

test("long pages scroll smoothly by wheel, as far as the wheel says; keys, the workspace and the stage keep their own", async ({ page }) => {
  await page.goto("/engineering?scenario=tower-fault");
  const view = page.locator(".main__view");
  const top = () => view.evaluate((el) => Math.round(el.scrollTop));
  await expect(view).toHaveClass(/\blenis\b/);
  const box = (await view.boundingBox())!;
  await page.mouse.move(box.x + 200, box.y + 300);
  await page.mouse.wheel(0, 100);
  await expect.poll(top).toBe(100); // a glide, to where a native notch lands
  // Keys scroll natively, and the smoothing follows: the next notch goes on from there.
  await page.locator(".hub").getByRole("link").first().focus();
  await page.keyboard.press("End");
  const end = await view.evaluate((el) => el.scrollHeight - el.clientHeight);
  await expect.poll(top).toBe(end);
  await page.mouse.wheel(0, -100);
  await expect.poll(top).toBe(end - 100);
  // The workspace scrolls on its own; the page stays where it is.
  const ws = (await page.locator(".workspace").boundingBox())!;
  await page.mouse.move(ws.x + 100, ws.y + 300);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(400);
  expect(await top()).toBe(end - 100);
  // Off where it would get in the way: the Overview's stage (its wheel zooms the plant) and a phone.
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Overview", exact: true }).click();
  await expect(view).not.toHaveClass(/\blenis\b/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/engineering");
  await expect(page.locator(".hub")).toBeVisible();
  await expect(view).not.toHaveClass(/\blenis\b/);
});

test("unknown address explains itself", async ({ page }) => {
  await page.goto("/no-such-screen");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
});

test("narrow screens use a bottom tab bar with names and keep the data mode visible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("Demo data", { exact: true })).toBeVisible();
  await expect(nav(page)).toBeVisible();
  const bar = (await nav(page).boundingBox())!;
  expect(bar.y + bar.height).toBeCloseTo(844, -1);
  await expect(nav(page).getByText("Engineering")).toBeVisible();
  const target = (await nav(page).getByRole("link", { name: "Engineering", exact: true }).boundingBox())!;
  expect(target.height).toBeGreaterThanOrEqual(50);
  await dock("Engineering")(page);
  await expect(page.getByRole("heading", { level: 1, name: "Engineering" })).toBeVisible();
  await expect(page.getByText("Demo data", { exact: true })).toBeVisible();
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

// Forced colours (F8): system colours throughout, and no serious or critical findings.
for (const path of ["/?scenario=tower-fault", "/?view=list&scenario=tower-fault", "/engineering?scenario=tower-fault", "/equipment/chiller_plant_2"]) {
  test(`no serious accessibility violations under forced colours on ${path}`, async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForTimeout(300);
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
  });
}

for (const path of ["/", "/?view=list", "/engineering", "/equipment/chiller_plant_2", "/prediction", "/knowledge"]) {
  test(`no serious accessibility violations on ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForTimeout(300);
    // Contrast is read as drawn: a page still fading in (the Knowledge page mounts its 3D
    // view first) is not yet its colours.
    await settled(page);
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
  });
}
