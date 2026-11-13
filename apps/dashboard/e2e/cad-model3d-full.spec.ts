import { expect, test, type Page } from "@playwright/test";

async function openSample(page: Page) {
  await page.goto("/cad");
  await page.getByRole("button", { name: /Water-cooled plant/i }).click();
  const skip = page.getByRole("button", { name: "Skip" });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.getByRole("radio", { name: "3D", exact: true }).click();
}

async function rendered(page: Page) {
  const host = page.locator(".cad-3d");
  await host.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(() => Number((document.querySelector(".cad-3d") as HTMLElement | null)?.dataset.frames) > 0);
  return host;
}

const stats = (page: Page) => page.locator(".cad-3d").evaluate((element) => ({ ...(element as HTMLElement).dataset }));
const angle = (value: number) => ((value % 360) + 360) % 360;
const zoomControl = (page: Page, name: string) => page.locator(".cad-zoom").getByRole("button", { name, exact: true });

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`page: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 1280, height: 800 }]) {
  test(`complete plant renders without overflow at ${viewport.width} × ${viewport.height}`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize(viewport);
    await openSample(page);
    const host = await rendered(page);
    const initial = await stats(page);
    expect(Number(initial.equipment)).toBe(16);
    expect(Number(initial.runs)).toBe(41);
    expect(Number(initial.fittings)).toBe(20);
    expect(Number(initial.drawCalls)).toBeGreaterThan(100);
    expect(Number(initial.triangles)).toBeGreaterThan(20_000);
    expect(Number(initial.visibleCw)).toBeGreaterThan(0);
    expect(Number(initial.visibleChw)).toBeGreaterThan(0);
    expect(Number(initial.visibleValves)).toBeGreaterThan(0);
    expect(Number(initial.visibleInstruments)).toBeGreaterThan(0);
    expect(initial.view).toBe("isometric");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const width = await page.locator(".cad-wb").evaluate((element) => element.clientWidth);
    if (width < 1366) await expect(page.locator(".cad-wb")).toHaveAttribute("data-library", "closed");
    const canvas = await host.locator("canvas").boundingBox();
    expect(canvas!.width).toBeGreaterThan(width * 0.55);
    const assertCentered = async () => {
      const [left, top, right, bottom] = (await stats(page)).fitBounds!.split(",").map(Number);
      expect(Math.abs((left + right - canvas!.width) / 2)).toBeLessThan(1);
      expect(Math.abs((top + bottom - canvas!.height) / 2)).toBeLessThan(1);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(right).toBeLessThanOrEqual(canvas!.width);
      expect(bottom).toBeLessThanOrEqual(canvas!.height);
    };
    await assertCentered();
    await zoomControl(page, "Fit model").click();
    await assertCentered();
    expect(errors).toEqual([]);
  });
}

test("desktop camera supports continuous orbit, bounded pan, zoom limits, fit, reset and plan", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openSample(page);
  const host = await rendered(page);
  await host.focus();
  for (let i = 0; i < 24; i++) await host.press("Shift+ArrowRight");
  await expect.poll(async () => angle(Number((await stats(page)).azimuth))).toBeCloseTo(angle(-45), 1);
  expect(Number((await stats(page)).polar)).toBeCloseTo(54.74, 1);
  for (let i = 0; i < 12; i++) await host.press("Shift+ArrowUp");
  await expect.poll(async () => Number((await stats(page)).polar)).toBe(0);
  for (let i = 0; i < 20; i++) await host.press("Shift+ArrowDown");
  await expect.poll(async () => Number((await stats(page)).polar)).toBe(80);
  await zoomControl(page, "Reset isometric view").click();
  await expect.poll(async () => (await stats(page)).view).toBe("isometric");
  await expect.poll(async () => Number((await stats(page)).polar)).toBeCloseTo(54.74, 1);

  const canvas = await host.locator("canvas").boundingBox();
  const x = canvas!.x + canvas!.width / 2;
  const y = canvas!.y + canvas!.height / 2;
  const beforeOrbit = Number((await stats(page)).azimuth);
  await page.mouse.move(x, y);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(x + 160, y + 35, { steps: 16 });
  await page.mouse.up({ button: "left" });
  await expect.poll(async () => Number((await stats(page)).azimuth)).not.toBe(beforeOrbit);
  await expect(page.locator(".cad-insp__back")).toHaveCount(0);

  const beforePan = await stats(page);
  await page.mouse.move(x, y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(x - 110, y + 50, { steps: 12 });
  await page.mouse.up({ button: "right" });
  await expect.poll(async () => (await stats(page)).targetX).not.toBe(beforePan.targetX);
  await expect(page.locator(".cad-insp__back")).toHaveCount(0);

  await zoomControl(page, "Reset isometric view").click();
  await expect.poll(async () => (await stats(page)).view).toBe("isometric");
  await host.focus();
  await host.evaluate((element) => {
    for (let i = 0; i < 80; i++) element.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    for (let i = 0; i < 80; i++) element.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  });
  await page.waitForTimeout(200);
  const bounded = await stats(page);
  await host.evaluate((element) => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  });
  await expect.poll(async () => (await stats(page)).targetX).toBe(bounded.targetX);
  expect((await stats(page)).targetY).toBe(bounded.targetY);
  expect((await stats(page)).targetZ).toBe(bounded.targetZ);
  await host.press("ArrowLeft");
  await host.press("ArrowDown");
  await expect.poll(async () => (await stats(page)).targetX).not.toBe(bounded.targetX);
  expect((await stats(page)).targetY).not.toBe(bounded.targetY);

  await zoomControl(page, "Fit model").click();
  await expect.poll(async () => (await stats(page)).zoom).toBe("1.0000");
  const beforeWheel = Number((await stats(page)).zoom);
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => Number((await stats(page)).zoom)).toBeGreaterThan(beforeWheel);
  for (let i = 0; i < 12; i++) await zoomControl(page, "Zoom in").click();
  await expect.poll(async () => (await stats(page)).zoom).toBe("8.0000");
  for (let i = 0; i < 18; i++) await zoomControl(page, "Zoom out").click();
  await expect.poll(async () => (await stats(page)).zoom).toBe("0.5000");
  await zoomControl(page, "Fit model").click();
  await expect.poll(async () => (await stats(page)).zoom).toBe("1.0000");
  await zoomControl(page, "Plan view").click();
  await expect.poll(async () => (await stats(page)).view).toBe("plan");
  expect(Number((await stats(page)).polar)).toBe(0);
  await host.focus();
  await host.press("Shift+ArrowRight");
  await expect.poll(async () => (await stats(page)).view).toBe("custom");
  await page.locator(".cad-tb__aux").getByRole("button", { name: "Plan view", exact: true }).click();
  await expect.poll(async () => (await stats(page)).view).toBe("plan");
  expect(Number((await stats(page)).polar)).toBe(0);
  await zoomControl(page, "Reset isometric view").click();
  await expect.poll(async () => Number((await stats(page)).azimuth)).toBeCloseTo(-45, 1);
  expect(errors).toEqual([]);
});

test("desktop selection, trace, findings, layers, colour modes and view switching stay synchronized", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openSample(page);
  const host = await rendered(page);
  const plate = page.locator('[data-equipment-id="chiller_plant_2"]');
  await expect(plate).toBeVisible();
  const leader = host.locator('[data-leader="chiller_plant_2"]');
  await expect(leader).toHaveCSS("visibility", "visible");
  expect(await leader.evaluate((line) => Math.hypot(
    Number(line.getAttribute("x2")) - Number(line.getAttribute("x1")),
    Number(line.getAttribute("y2")) - Number(line.getAttribute("y1")),
  ))).toBeGreaterThanOrEqual(5);
  const box = await plate.boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height + 45);
  await expect(page.locator(".cad-insp__back")).toBeVisible();
  await plate.click();
  await expect(page.locator("#cad-review-title")).toHaveText("Chiller 2");
  await expect(plate).toHaveAttribute("aria-pressed", "true");
  expect(Number((await stats(page)).dimmed)).toBeGreaterThan(0);
  await zoomControl(page, "Plan view").click();
  await expect(page.locator("#cad-review-title")).toHaveText("Chiller 2");
  await page.getByRole("radio", { name: "2D", exact: true }).click();
  await expect(page.locator("#cad-review-title")).toHaveText("Chiller 2");
  await page.getByRole("radio", { name: "Compare", exact: true }).click();
  await expect(page.getByRole("group", { name: "Plant scene" })).toBeVisible();
  await expect(page.locator("#cad-review-title")).toHaveText("Chiller 2");
  await page.getByRole("radio", { name: "3D", exact: true }).click();
  await rendered(page);
  await expect(plate).toHaveAttribute("aria-pressed", "true");
  await page.locator(".cad-insp__back").click();
  await page.locator(".cad-finds .cad-find").first().click();
  await expect.poll(async () => (await stats(page)).focus).toBe("cooling_water_pump_4");
  await expect(page.locator(".cad-insp")).toContainText("cooling_water_pump_4_cw_supply");

  await page.locator(".cad-layers summary").click();
  for (const [name, key] of [["CW", "visibleCw"], ["CHW", "visibleChw"], ["Valves", "visibleValves"], ["Instruments", "visibleInstruments"]] as const) {
    await page.getByRole("checkbox", { name, exact: true }).uncheck();
    await expect.poll(async () => (await stats(page))[key]).toBe("0");
  }
  await page.getByRole("checkbox", { name: "Names", exact: true }).uncheck();
  await expect(plate).toHaveCSS("visibility", "hidden");
  await expect(host.locator('[data-leader="chiller_plant_2"]')).toHaveCSS("visibility", "hidden");
  for (const name of ["CW", "CHW", "Valves", "Instruments", "Names"]) {
    await page.getByRole("checkbox", { name, exact: true }).check();
  }
  await expect.poll(async () => Number((await stats(page)).visibleCw)).toBeGreaterThan(0);
  await expect.poll(async () => Number((await stats(page)).visibleChw)).toBeGreaterThan(0);
  await page.getByRole("radio", { name: "Colour by Review", exact: true }).click();
  await expect(host).toHaveAttribute("data-colour-by", "review");
  await page.getByRole("radio", { name: "Colour by Medium", exact: true }).click();
  await expect(host).toHaveAttribute("data-colour-by", "medium");
  await page.waitForTimeout(200);
  const idle = (await stats(page)).frames;
  await page.waitForTimeout(300);
  expect((await stats(page)).frames).toBe(idle);
  expect(errors).toEqual([]);
});

test("a lost graphics context falls back to 2D and a fresh 3D context can be created", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openSample(page);
  await rendered(page);
  await page.locator(".cad-3d canvas").evaluate((canvas) => {
    const gl = (canvas as HTMLCanvasElement).getContext("webgl2")!;
    gl.getExtension("WEBGL_lose_context")!.loseContext();
  });
  await expect(page.getByText("The 3D view stopped. Showing the 2D drawing.")).toBeVisible();
  await page.getByRole("radio", { name: "2D", exact: true }).click();
  await page.getByRole("radio", { name: "3D", exact: true }).click();
  const host = await rendered(page);
  await expect(host.locator("canvas")).toHaveCount(1);
  expect(Number((await stats(page)).equipment)).toBe(16);
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
  test(`left-drag orbits, right/middle pan and labels share every frame at ${viewport.width} × ${viewport.height}`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize(viewport);
    await openSample(page);
    const host = await rendered(page);
    const canvas = host.locator("canvas");
    const plate = host.locator('[data-equipment-id="chiller_plant_2"]');
    await expect(plate).toBeVisible();
    await expect(canvas).toHaveCSS("cursor", "grab");
    await host.evaluate((element) => {
      const mismatches: string[] = [];
      const attachments: string[] = [];
      const observer = new MutationObserver(() => {
        if (element.dataset.frames !== element.dataset.labelFrame) mismatches.push(`${element.dataset.frames}/${element.dataset.labelFrame}`);
        const line = element.querySelector('[data-leader="chiller_plant_2"]');
        const label = element.querySelector('[data-equipment-id="chiller_plant_2"]');
        if (!line || !label || getComputedStyle(line).visibility !== "visible" || getComputedStyle(label).visibility !== "visible") return;
        const rect = label.getBoundingClientRect();
        const hostRect = element.getBoundingClientRect();
        const x = Number(line.getAttribute("x2"));
        const y = Number(line.getAttribute("y2"));
        if (x < rect.left - hostRect.left - 1.6 || x > rect.right - hostRect.left + 1.6 || y < rect.top - hostRect.top - 1.6 || y > rect.bottom - hostRect.top + 1.6) {
          attachments.push(`${x},${y} outside ${rect.left - hostRect.left},${rect.top - hostRect.top},${rect.right - hostRect.left},${rect.bottom - hostRect.top}`);
        }
      });
      observer.observe(element, { attributes: true, attributeFilter: ["data-frames", "data-label-frame"] });
      Object.assign(window, { cadLabelObserver: observer, cadLabelMismatches: mismatches, cadLabelAttachments: attachments });
    });

    const initial = await stats(page);
    expect(initial.labelFrame).toBe(initial.frames);
    const labelBox = await plate.boundingBox();
    const startX = labelBox!.x + labelBox!.width / 2;
    const startY = labelBox!.y + labelBox!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: "left" });
    await page.mouse.move(startX + 8, startY + 1);
    await expect(canvas).toHaveCSS("cursor", "grabbing");
    for (let i = 1; i <= 10; i++) await page.mouse.move(startX + i * 14, startY + i * 3);
    await page.mouse.up({ button: "left" });
    await expect(canvas).toHaveCSS("cursor", "grab");
    expect(Number((await stats(page)).azimuth)).not.toBe(Number(initial.azimuth));
    expect(Number((await stats(page)).polar)).not.toBe(Number(initial.polar));
    await expect(page.locator(".cad-insp__back")).toHaveCount(0);

    const beforePan = await stats(page);
    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(startX - 85, startY + 35, { steps: 7 });
    await page.mouse.up({ button: "right" });
    await expect.poll(async () => (await stats(page)).targetX).not.toBe(beforePan.targetX);
    const beforeMiddle = await stats(page);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(startX - 35, startY + 10, { steps: 4 });
    await page.mouse.up({ button: "middle" });
    await expect.poll(async () => (await stats(page)).targetX).not.toBe(beforeMiddle.targetX);
    await expect(page.locator(".cad-insp__back")).toHaveCount(0);

    const beforeZoom = Number((await stats(page)).zoom);
    await page.mouse.wheel(0, -240);
    await expect.poll(async () => Number((await stats(page)).zoom)).toBeGreaterThan(beforeZoom);
    const canvasBox = await canvas.boundingBox();
    const fastX = canvasBox!.x + canvasBox!.width * 0.55;
    const fastY = canvasBox!.y + canvasBox!.height * 0.55;
    const beforeFast = Number((await stats(page)).azimuth);
    await page.mouse.move(fastX, fastY);
    await page.mouse.down({ button: "left" });
    for (let i = 1; i <= 9; i++) await page.mouse.move(fastX + i * 25, fastY - i * 2);
    await page.mouse.up({ button: "left" });
    expect(Number((await stats(page)).azimuth)).not.toBe(beforeFast);
    const settled = await stats(page);
    await expect.poll(async () => (await stats(page)).labelFrame).toBe(settled.frames);
    const transform = await plate.getAttribute("style");
    await page.waitForTimeout(200);
    expect(await plate.getAttribute("style")).toBe(transform);
    expect((await stats(page)).frames).toBe(settled.frames);
    const tracked = await page.evaluate(() => {
      const tracker = window as unknown as { cadLabelObserver: MutationObserver; cadLabelMismatches: string[]; cadLabelAttachments: string[] };
      tracker.cadLabelObserver.disconnect();
      return { mismatches: tracker.cadLabelMismatches, attachments: tracker.cadLabelAttachments };
    });
    expect(tracked.mismatches).toEqual([]);
    expect(tracked.attachments).toEqual([]);

    await zoomControl(page, "Reset isometric view").click();
    await expect(plate).toBeVisible();
    const selectedBox = await plate.boundingBox();
    await page.mouse.click(selectedBox!.x + selectedBox!.width / 2, selectedBox!.y + selectedBox!.height + 45);
    await expect(page.locator(".cad-insp__back")).toBeVisible();
    await plate.click();
    await expect(page.locator("#cad-review-title")).toHaveText("Chiller 2");
    expect(errors).toEqual([]);
  });
}
