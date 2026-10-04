/** M4: Cooling prediction page. */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const idOnPage = (page: Page) => page.locator(".context-bar [data-forecast-id]");

async function open(page: Page, url = "/prediction") {
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1, name: "Cooling prediction" })).toBeVisible();
}

test("states plainly that the forecast is a demo baseline, not a trained model", async ({ page }) => {
  await open(page);
  await expect(page.getByText(/not a trained or validated AI model, and no accuracy is claimed/)).toBeVisible();
  await expect(idOnPage(page)).toHaveAttribute("data-forecast-id", /^fc-normal-.*-h360-s15$/);
  await expect(page.getByRole("img", { name: /Observed and forecast site cooling demand/ })).toBeVisible();
  const provenance = page.getByRole("region", { name: "Forecast provenance" });
  await expect(provenance).toContainText("Baseline: demo-seasonal-profile-baseline");
  await expect(provenance).toContainText("uncalibrated, not a prediction interval with known coverage");
});

test("the monitoring summary and the page show the same forecast", async ({ page }) => {
  await page.goto("/");
  const summary = page.locator(".forecast-summary");
  await expect(summary).toHaveAttribute("data-forecast-id", /^fc-normal-/);
  const id = await summary.getAttribute("data-forecast-id");
  const peak = (await summary.locator(".forecast-summary__peak").innerText()).trim();
  await summary.getByRole("link", { name: "View forecast" }).click();
  await expect(page).toHaveURL(/\/prediction\?forecast=/);
  await expect(idOnPage(page)).toHaveAttribute("data-forecast-id", id!);
  await expect(page.getByText(/Showing the forecast issued at 15:15/)).toBeVisible();
  const figures = page.getByRole("region", { name: "Predicted demand, capacity and delivery" });
  await expect(figures.locator(".figure").first()).toContainText(peak.replace(/\s+/g, " "));
  await page.getByRole("button", { name: "Show latest forecast" }).click();
  await expect(page).not.toHaveURL(/forecast=/);
});

test("an unknown forecast link says so and offers the latest", async ({ page }) => {
  await open(page, "/prediction?forecast=fc-peak-2026-09-28T07:15:00.000Z-h360-s15");
  await expect(page.getByText("The linked forecast does not exist for this site and source.")).toBeVisible();
  await page.getByRole("button", { name: "Show latest forecast" }).click();
  await expect(idOnPage(page)).toHaveAttribute("data-forecast-id", /^fc-normal-/);
});

test("horizon and interval come from the advertised capabilities", async ({ page }) => {
  await open(page);
  const horizon = page.getByRole("group", { name: "Horizon" });
  await expect(horizon.getByRole("button")).toHaveText(["6 h", "12 h", "24 h"]);
  await horizon.getByRole("button", { name: "24 h" }).click();
  await expect(idOnPage(page)).toHaveAttribute("data-forecast-id", /-h1440-s15$/);
  await page.getByRole("group", { name: "Interval" }).getByRole("button", { name: "60 min" }).click();
  await expect(idOnPage(page)).toHaveAttribute("data-forecast-id", /-h1440-s60$/);
  await page.getByRole("group", { name: "History shown" }).getByRole("button", { name: "7 days" }).click();
  await expect(page.getByRole("img", { name: /Observed and forecast/ })).toBeVisible();
});

test("predicted demand, running capacity and delivered cooling stay distinct and link to their indicators", async ({ page }) => {
  await open(page);
  const figures = page.getByRole("region", { name: "Predicted demand, capacity and delivery" });
  await expect(figures.getByText("Predicted peak demand")).toBeVisible();
  await expect(figures.getByText("Running chiller capacity at cutoff")).toBeVisible();
  await expect(figures.getByText("Cooling delivered at cutoff")).toBeVisible();
  await expect(figures.getByText(/not an overload prediction/)).toBeVisible();
  const legend = page.locator(".prediction__main .ts-chart__legend");
  await expect(legend).toContainText("Predicted demand");
  await expect(legend).toContainText("Running chiller capacity");
  await page.getByRole("checkbox", { name: "Running chiller capacity" }).uncheck();
  await expect(legend).not.toContainText("Running chiller capacity");
  await figures.getByRole("link", { name: "Details" }).nth(1).click();
  await expect(page).toHaveURL(/\/\?kpi=plant:cooling_delivered_kw/);
  await expect(page.getByRole("complementary", { name: "Indicator details" }).getByRole("heading", { level: 2 })).toHaveText("Cooling delivered");
});

test("readiness lists only the baseline as available, with reasons for the rest", async ({ page }) => {
  await open(page);
  const readiness = page.getByRole("region", { name: "Forecasting readiness" });
  await expect(readiness.locator('[data-mode="baseline"]')).toContainText("Available");
  await expect(readiness.locator('[data-mode="pretrained"]')).toContainText("No pretrained forecasting model artifact is installed.");
  await expect(readiness.locator('[data-mode="site_adapted"]')).toContainText("Not available");
});

test("too little history makes the forecast unavailable with the reason and next step", async ({ page }) => {
  await open(page, "/prediction?scenario=new-site");
  await expect(page.getByText(/Forecast unavailable\./)).toBeVisible();
  await expect(page.getByText(/Not enough demand history yet/)).toBeVisible();
  await expect(page.getByText(/Forecasts become available once enough demand history/)).toBeVisible();
  await expect(page.locator(".prediction__main .ts-chart__legend")).not.toContainText("Predicted demand");
  await expect(page.getByRole("region", { name: "Forecasting readiness" })).toContainText("1 day of demand history available; at least 3 needed.");
});

test("stale inputs are flagged; very stale inputs make the forecast unavailable", async ({ page }) => {
  await open(page, "/prediction?scenario=disconnected&time=15:30");
  await expect(page.getByRole("alert").filter({ hasText: "Inputs end 50 minutes before the cutoff" })).toBeVisible();
  await page.goto("/prediction?scenario=disconnected&time=17:00");
  await expect(page.getByText(/Demand inputs are too old to forecast from/)).toBeVisible();
});

test("comparison shows an earlier forecast against observed demand, without accuracy claims", async ({ page }) => {
  await open(page);
  const cmp = page.getByRole("region", { name: "Earlier forecast against what happened" });
  await expect(cmp.getByText("Visual comparison only. No accuracy is computed or claimed.")).toBeVisible();
  await expect(cmp.locator(".ts-chart__legend")).toContainText("Earlier forecast (09:15)");
  await cmp.getByRole("button", { name: "3 h earlier" }).click();
  await expect(cmp.locator(".ts-chart__legend")).toContainText("Earlier forecast (12:15)");
});

test("replay moves the cutoff and therefore the forecast", async ({ page }) => {
  await open(page, "/prediction?time=10:00");
  await expect(idOnPage(page)).toHaveAttribute("data-forecast-id", /T02:00:00\.000Z/);
  const slider = page.getByRole("slider", { name: "Time of day" });
  for (let i = 0; i < 3; i++) await slider.press("ArrowRight");
  await expect(idOnPage(page)).toHaveAttribute("data-forecast-id", /T02:15:00\.000Z/);
});

test("a failed forecast request is shown with a retry", async ({ page }) => {
  await open(page, "/prediction?fail=forecast:unavailable");
  await expect(page.getByText(/Could not load the forecast/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("narrow layout has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(page.getByRole("img", { name: /Observed and forecast/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test("no serious accessibility violations on the prediction page", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("img", { name: /Observed and forecast/ })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
});
