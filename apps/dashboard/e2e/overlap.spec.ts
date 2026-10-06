/**
 * F4 overlap guarantee: at fit, the three corner controls never cover equipment, names,
 * readings or issue tags, and the drawing's own overlays never collide, from 1920x1080
 * down to 1024x768. Beside a floating panel nothing is covered when the plant refits;
 * when it cannot (1024), alarms move to the panel's edge.
 */
import { expect, test, type Page } from "@playwright/test";

type Box = { k: string; id?: string | null; left: number; top: number; right: number; bottom: number };

const SIZES: [number, number, string][] = [
  [1920, 1080, ""],
  [1440, 900, ""],
  [1440, 900, "collapsed"],
  [1366, 768, ""],
  [1280, 800, ""],
  [1024, 768, ""],
];

/** Every collision on the stage, described. Pure DOM geometry, run in the page. */
function collisions(): string[] {
  const hit = (a: Box, b: Box) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  const of = (k: string, el: Element, inset = 0, id?: string | null): Box => {
    const r = el.getBoundingClientRect();
    return { k, id, left: r.left + inset, top: r.top + inset, right: r.right - inset, bottom: r.bottom - inset };
  };
  const text = (el: Element) => (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 24);
  const eq = [...document.querySelectorAll<SVGGElement>(".plant-view__box [data-equipment-id]")].map((g) =>
    of(`equipment ${g.dataset.equipmentId}`, g.querySelector(".eq-node__art")!, 4, g.dataset.equipmentId),
  );
  const overlays = [...document.querySelectorAll(".plant-view__overlay .lbl, .plant-view__overlay .key, .plant-view__overlay .hang")].map((e) =>
    of(`${e.className.split(" ")[0]} "${text(e)}"`, e, 0, e.getAttribute("data-for")),
  );
  const drawn = [...document.querySelectorAll(".plant-view__box .eq-node__label, .plant-view__box g.tag, .plant-view__box .scene-caption")].map((e) =>
    of(`drawn "${text(e)}"`, e),
  );
  const out: string[] = [];
  for (let i = 0; i < overlays.length; i++) for (let j = i + 1; j < overlays.length; j++) if (hit(overlays[i], overlays[j])) out.push(`${overlays[i].k} x ${overlays[j].k}`);
  for (const o of overlays) if (!o.k.startsWith("hang")) for (const e of eq) if (o.id !== e.id && hit(o, e)) out.push(`${o.k} on ${e.k}`);
  for (const sel of [".stage-note", ".viewswitch", ".stage-controls"]) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const c = of(sel, el);
    for (const t of [...eq, ...overlays, ...drawn]) if (hit(c, t)) out.push(`${sel} on ${t.k}`);
  }
  return out;
}

async function settle(page: Page) {
  await expect(page.locator(".plant-view__box [data-equipment-id]")).toHaveCount(16);
  await expect(page.locator('[data-kpi="plant:cooling_demand_kw"] .readout__value')).toContainText(/\d/);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

for (const scenario of ["tower-fault", "normal", "disconnected"]) {
  for (const [w, h, mode] of SIZES) {
    test(`corners and overlays are clear at fit: ${scenario} ${w}x${h}${mode ? ` ${mode}` : ""}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`/?scenario=${scenario}`);
      await settle(page);
      if (mode === "collapsed") {
        await page.getByRole("button", { name: "Collapse workspace" }).click();
        await settle(page);
      }
      expect(await page.evaluate(collisions)).toEqual([]);
    });
  }
}

for (const [w, h] of [
  [1366, 768],
  [1280, 800],
] as const) {
  test(`beside a floating panel nothing is covered: ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/?scenario=tower-fault");
    await settle(page);
    await page.locator('.plant-view__box [data-equipment-id="chiller_plant_2"] .eq-node__art').click();
    const panel = page.locator(".workspace--float");
    await expect(panel).toBeVisible();
    await page.waitForTimeout(500);
    const left = (await panel.boundingBox())!.x;
    const right = await page.locator(".plant-view__box .eq-node__art").evaluateAll((els) => Math.max(...els.map((e) => e.getBoundingClientRect().right)));
    expect(right).toBeLessThanOrEqual(left);
    expect(await page.evaluate(collisions)).toEqual([]);
  });
}

test("at 1024x768 the panel covers part of the plant, and alarms under it move to its edge", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/?scenario=tower-fault");
  await settle(page);
  // Zoomed in on the towers, then Details for Chiller 2: the fault's tag would sit under the panel.
  const zoomIn = page.getByRole("toolbar", { name: "Drawing" }).getByRole("button", { name: "Zoom in" });
  await zoomIn.click();
  await zoomIn.click();
  await page.locator('.plant-view__box [data-equipment-id="chiller_plant_2"] .eq-node__art').click();
  const panel = page.locator(".workspace--float");
  await expect(panel).toBeVisible();
  await page.waitForTimeout(500);
  const left = (await panel.boundingBox())!.x;
  for (const tag of await page.locator(".plant-view__overlay .hang").all()) {
    const b = (await tag.boundingBox())!;
    expect(b.x + b.width, await tag.textContent() ?? "").toBeLessThanOrEqual(left);
  }
});
