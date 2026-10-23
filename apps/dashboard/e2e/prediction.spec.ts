/** Cooling prediction (the Prediction tab): Predict, then play the plant and log the actual load. */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const chart = (page: Page) => page.getByRole("img", { name: /Predicted and actual cooling load/ });
const figures = (page: Page) => page.locator('[data-prediction="figures"]');
const logged = (page: Page) => figures(page).locator(".prediction__figure").filter({ hasText: "Logged so far" }).locator("dd").first();
const deck = (page: Page) => page.getByRole("contentinfo", { name: "Data source and time" });

async function open(page: Page, url = "/prediction") {
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1, name: "Cooling prediction" })).toBeVisible();
}

test("starts with an empty chart and Predict, and states the method plainly", async ({ page }) => {
  await open(page, "/prediction?time=12:00");
  await expect(page.getByText(/not a trained AI model/)).toBeVisible();
  await expect(chart(page)).toBeVisible();
  await expect(page.getByText("Press Predict to forecast the cooling load from 12:00")).toBeVisible();
  await expect(figures(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Predict", exact: true })).toBeVisible();
});

test("Predict draws the curve; playing the plant from the deck logs the actual load", async ({ page }) => {
  // In the replay, so the timeline can be dragged as well; both sources log the same way.
  await open(page, "/prediction?time=12:00&mode=replay");
  await page.getByRole("button", { name: "Predict", exact: true }).click();
  await expect(page.locator(".ts-chart__legend")).toContainText("Predicted cooling load");
  await expect(logged(page)).toHaveText("0 of 24 points");
  await expect(figures(page)).toContainText("Seasonal-profile baseline (demo-seasonal-profile-baseline)");
  await expect(page.locator('[data-prediction="status"]')).toContainText("Press Play replay in the bar below");
  await expect(page.getByRole("button", { name: "Predict again" })).toBeVisible();

  // The same global clock as the Overview: play it from the deck, fast.
  await deck(page).getByRole("combobox").selectOption("900");
  await deck(page).getByRole("button", { name: "Play replay" }).click();
  await expect(page.locator('[data-prediction="status"]')).toContainText("Playing at 900×");
  await expect.poll(async () => Number((await logged(page).innerText()).split(" ")[0]), { timeout: 15_000 }).toBeGreaterThan(1);
  await expect(page.locator(".ts-chart__legend")).toContainText("Actual cooling load");
  await expect(figures(page).filter({ hasText: "Mean absolute error so far" })).toContainText("kWt");
});

test("the prediction stays while the operator watches the Overview, and Clear empties the chart", async ({ page }) => {
  await open(page, "/prediction?time=12:00");
  await page.getByRole("button", { name: "Predict", exact: true }).click();
  await expect(logged(page)).toBeVisible();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Overview", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Prediction", exact: true }).click();
  await expect(logged(page)).toBeVisible();
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(figures(page)).toHaveCount(0);
  await expect(page.getByText(/Press Predict to forecast the cooling load from/)).toBeVisible();
});

test("the top bar's outlook opens that forecast on the chart", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "More readings" }).click();
  const outlook = page.getByRole("region", { name: "More readings" }).getByRole("link", { name: /Outlook, 6 h: peak at/ });
  await expect(outlook).toHaveAttribute("href", /forecast=fc-normal-/);
  const peak = (await outlook.locator(".tray__value").innerText()).match(/[\d,]+/)![0];
  await outlook.click();
  await expect(page).toHaveURL(/\/prediction\?forecast=/);
  await expect(page.getByText(/Showing the forecast issued at 15:15/)).toBeVisible();
  await expect(figures(page).filter({ hasText: "Predicted peak" })).toContainText(peak);
});

test("an unknown forecast link says so, and Predict still works", async ({ page }) => {
  await open(page, "/prediction?forecast=fc-peak-2026-09-28T07:15:00.000Z-h360-s15");
  await expect(page.getByText("The linked forecast does not exist for this site and source.")).toBeVisible();
  await page.getByRole("button", { name: "Predict", exact: true }).click();
  await expect(figures(page)).toBeVisible();
  await expect(page).not.toHaveURL(/forecast=/);
});

test("too little history makes the prediction unavailable with the reason and next step", async ({ page }) => {
  await open(page, "/prediction?scenario=new-site");
  await page.getByRole("button", { name: "Predict", exact: true }).click();
  await expect(page.getByText(/Forecast unavailable\./)).toBeVisible();
  await expect(page.getByText(/Forecasts become available once enough demand history/)).toBeVisible();
});

test("a failed prediction request is shown with a retry", async ({ page }) => {
  await open(page, "/prediction?fail=forecast:unavailable");
  await page.getByRole("button", { name: "Predict", exact: true }).click();
  await expect(page.getByText(/Could not load the forecast/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("narrow layout has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.getByRole("button", { name: "Predict", exact: true }).click();
  await expect(figures(page)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test("no serious accessibility violations on the prediction page", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Predict", exact: true }).click();
  await expect(figures(page)).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
});
