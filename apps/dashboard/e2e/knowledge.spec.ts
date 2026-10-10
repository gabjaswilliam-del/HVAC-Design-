/**
 * M7: the Knowledge workspace in demo mode. Graph RAG over the fixed demo library (synthetic
 * documents indexed by the real rule-based pipeline when the snapshot was made) and Graph
 * Memory over the fixed demo records: tabs, library, documents, the source reader, search
 * with its evidence, the knowledge graph in 3D (WebGL, drawn by SwiftShader in headless
 * Chromium) and 2D, the memory timeline and graph, failures, keyboard, reduced motion and
 * accessibility. The local services are covered by knowledge-local.spec.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** Axe reads colours as drawn: CSS fades and GSAP motion (`html[data-motion]`, and the
 *  inline opacity a GSAP fade leaves until it ends) must be done. */
const settled = (page: Page) =>
  page.waitForFunction(
    () =>
      !document.documentElement.dataset.motion &&
      !document.querySelector('.knowledge [style*="opacity"]') &&
      document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getComputedTiming().endTime === Infinity),
  );
const tab = (page: Page, name: "Graph RAG" | "Graph Memory") => page.getByRole("tab", { name });
const panel = (page: Page) => page.locator(".kn-panel");

async function open(page: Page, query = "") {
  await page.goto(`/knowledge${query}`);
  await expect(page.getByRole("heading", { level: 1, name: "Knowledge" })).toBeVisible();
}
async function serious(page: Page) {
  await settled(page);
  const results = await new AxeBuilder({ page }).include(".knowledge").analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
}

test("Knowledge holds Graph RAG and Graph Memory as two tabs, with no second destination", async ({ page }) => {
  await open(page);
  await expect(tab(page, "Graph RAG")).toHaveAttribute("aria-selected", "true");
  await expect(tab(page, "Graph Memory")).toHaveAttribute("aria-selected", "false");
  await expect(page.getByText("Demo library, read only")).toBeVisible();
  // The dock keeps its four sections; Graph Memory has no destination of its own.
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.getByRole("link", { name: "Knowledge", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: /memory/i })).toHaveCount(0);
  // Arrow keys move between the tabs; the address keeps the tab.
  await tab(page, "Graph RAG").focus();
  await page.keyboard.press("ArrowRight");
  await expect(tab(page, "Graph Memory")).toBeFocused();
  await expect(page).toHaveURL(/kn=memory/);
  await expect(page.getByText("Demo records, read only")).toBeVisible();
  await page.goBack();
  await expect(tab(page, "Graph RAG")).toHaveAttribute("aria-selected", "true");
});

test("the library lists what was indexed and what failed, and says the demo library is fixed", async ({ page }) => {
  await open(page);
  const table = page.locator(".kn-docs");
  await expect(table.locator("tbody tr")).toHaveCount(7);
  await expect(page.getByText("7 documents · 29 passages")).toBeVisible();
  const failed = table.locator("tr", { hasText: "Demo drawing register" });
  await expect(failed).toContainText("Failed");
  await expect(failed).toContainText("The file has no text to index.");
  await expect(table.locator("tr", { hasText: "Demo chiller maintenance guide" })).toContainText("Indexed");
  // What the service can and cannot do, as facts.
  const caps = page.locator(".kn-caps");
  await expect(caps).toContainText("Demo snapshot, read only");
  await expect(caps).toContainText("PDF not configured");
  await expect(caps).toContainText("Rule-based HVAC vocabulary");
  await expect(caps).toContainText("Not generated: no language model is configured");
  // No management in the demo, and the reason is given.
  await expect(page.getByRole("button", { name: "Add document" })).toHaveCount(0);
  await expect(page.getByText(/The demo library is fixed/)).toBeVisible();
});

test("a document shows its ingestion stages and outline, and its sections open in the source reader", async ({ page }) => {
  await open(page);
  await page.locator(".kn-docs").getByRole("button", { name: "Demo site procedure: Chiller 2 condenser tube cleaning" }).click();
  await expect(panel(page).getByRole("heading", { name: "Demo site procedure: Chiller 2 condenser tube cleaning" })).toBeFocused();
  const stages = panel(page).locator(".kn-stage");
  await expect(stages).toHaveCount(8);
  const stage = (name: string) => stages.filter({ has: page.locator(".kn-stage__name", { hasText: new RegExp(`^${name}$`) }) });
  await expect(stage("Embeddings")).toContainText("Skipped");
  await expect(stage("Relationships")).toContainText("each with its source evidence");
  await expect(panel(page).getByRole("button", { name: "Reindex" })).toHaveCount(0);
  await panel(page).locator(".kn-outline").getByRole("button", { name: "Isolation steps" }).click();
  await expect(page).toHaveURL(/passage=chk_/);
  await expect(panel(page).getByRole("heading", { name: "Isolation steps" })).toBeVisible();
  await expect(panel(page).locator(".kn-passage")).toContainText("Stop CW pump 2, then close the condenser isolation valves of Chiller 2.");
  await panel(page).getByRole("button", { name: "Next" }).click();
  await expect(panel(page).locator(".kn-passage")).toContainText("Brush and flush the condenser tubes");
  // Escape closes the panel.
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
});

test("a citation that no longer resolves says so", async ({ page }) => {
  await open(page, "?passage=chk_000000000000_0001");
  await expect(panel(page).getByRole("heading", { name: "Passage unavailable" })).toBeVisible();
  await expect(panel(page)).toContainText("its document was removed or reindexed");
  await open(page, "?doc=doc_000000000000");
  await expect(panel(page)).toContainText("no longer in the library");
});

test("search returns stored passages with their source and how each was found, and writes no answer", async ({ page }) => {
  await open(page, "?kv=search");
  await page.getByRole("button", { name: "What are the common causes of low chiller COP?" }).click();
  const results = page.locator(".kn-hit");
  await expect(results.first()).toBeVisible();
  await expect(page.locator(".kn-methods")).toContainText("keyword (BM25)");
  await expect(page.locator(".kn-methods")).toContainText("graph from Low COP (Symptom)");
  await expect(page.locator(".kn-methods")).toContainText("vectors not configured");
  await expect(page.getByText(/No answer is written: no language model is configured/)).toBeVisible();
  const top = results.first();
  await expect(top).toContainText("Demo chiller maintenance guide");
  await expect(top).toContainText("Common causes of low COP");
  await expect(top.locator(".kn-method")).toContainText(["Keyword #1", "Graph #"]);
  await expect(top.locator(".kn-path").first()).toBeVisible();
  await expect(top.locator("mark").first()).toBeVisible();
  await expect(page.getByText(/the scores are not probabilities/)).toBeVisible();
  // The passage opens at its source, exactly as stored.
  await top.getByRole("button", { name: "Read passage" }).click();
  await expect(panel(page).locator(".kn-passage")).toContainText("Condenser tube fouling insulates the tubes");
  // Questions about procedures find the Chiller 2 procedure first.
  await page.getByRole("button", { name: "What maintenance procedures relate to Chiller 2?" }).click();
  await expect(results.first()).toContainText("Demo site procedure: Chiller 2 condenser tube cleaning");
  await expect(results.first().locator(".tag-chip", { hasText: "Procedure" })).toBeVisible();
  // Nothing matches: said plainly.
  await page.getByRole("searchbox", { name: "Question or keywords" }).fill("zeppelin");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText(/No indexed passage matches “zeppelin”/)).toBeVisible();
});

test("the 2D knowledge graph filters, finds, inspects and shows the evidence behind a relationship", async ({ page }) => {
  await open(page, "?kv=graph&gv=2d");
  const canvas = page.getByRole("group", { name: /Knowledge graph, \d+ nodes/ });
  await expect(canvas).toBeVisible();
  await expect(page.locator(".kn-count", { hasText: "128 nodes" })).toBeVisible();
  await expect(canvas.locator(".kn-node")).toHaveCount(128);
  // Filter by type.
  const types = page.getByRole("group", { name: "Show node types" });
  await types.getByRole("button", { name: /^Section/ }).click();
  await expect(types.getByRole("button", { name: /^Section/ })).toHaveAttribute("aria-pressed", "false");
  await expect(canvas.locator('.kn-node[data-type="section"]')).toHaveCount(0);
  await types.getByRole("button", { name: /^Section/ }).click();
  // Find a node and inspect it.
  await page.getByRole("searchbox", { name: "Find a node" }).fill("condenser tube fou");
  await page.locator(".kn-find__list").getByRole("button", { name: /Condenser tube fouling/ }).click();
  await expect(page).toHaveURL(/node=ent_fault_condenser_fouling/);
  await expect(canvas.locator('[data-node-id="ent_fault_condenser_fouling"]')).toHaveAttribute("aria-pressed", "true");
  await expect(panel(page).getByRole("heading", { name: "Condenser tube fouling" })).toBeVisible();
  await expect(panel(page)).toContainText("Mentioned");
  // A relationship and the source text that justifies it.
  await panel(page).getByRole("button", { name: /is associated with/ }).first().click();
  await expect(page).toHaveURL(/edge=rel_/);
  await expect(panel(page).getByRole("heading", { name: "Associated with" })).toBeVisible();
  await expect(panel(page)).toContainText("A fault and a symptom are named in one sentence");
  await expect(panel(page).locator(".kn-snippet mark").first()).toBeVisible();
  await panel(page).getByRole("button", { name: "Read passage" }).first().click();
  await expect(panel(page).locator(".kn-passage")).toBeVisible();
});

test("the 2D graph is usable from the keyboard, and focus comes back to it", async ({ page }) => {
  await open(page, "?kv=graph&gv=2d");
  const canvas = page.getByRole("group", { name: /Knowledge graph/ });
  await expect(canvas.locator(".kn-node").first()).toBeVisible();
  const stop = canvas.locator('.kn-node[tabindex="0"]');
  await expect(stop).toHaveCount(1);
  await stop.focus();
  const first = await stop.getAttribute("data-node-id");
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-node-id"))).not.toBe(first);
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-node-id"));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`node=${focused}`));
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/node=/);
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-node-id"))).toBe(focused);
});

/** The 3D view: its canvas, and the names drawn over it. */
const scene = (page: Page) => page.getByRole("application", { name: /Knowledge graph, \d+ nodes and \d+ relationships, in 3D/ });
const name3d = (page: Page, id: string) => page.locator(`.kn-3d__label[data-node-id="${id}"]`);
async function centreOffset(page: Page, id: string) {
  const box = (await scene(page).boundingBox())!;
  const label = (await name3d(page, id).boundingBox())!;
  return Math.abs(label.x + label.width / 2 - (box.x + box.width / 2));
}

test("the knowledge graph opens in 3D, clustered by document, with its families as the legend", async ({ page }) => {
  await open(page, "?kv=graph");
  await expect(page.getByRole("radio", { name: "3D" })).toHaveAttribute("aria-checked", "true");
  await expect(scene(page).locator("canvas")).toBeVisible();
  // Every document labels its cluster; nothing else crowds the overview.
  await expect(page.locator('.kn-3d__label--doc[data-show]')).toHaveCount(6);
  expect(await page.locator(".kn-3d__label[data-show]").count()).toBeLessThan(16);
  // The legend: four families, colour on the glyph, every type a filter.
  const types = page.getByRole("group", { name: "Show node types" });
  for (const family of ["Sources", "Plant and process", "Problems", "Guidance"]) await expect(types.getByRole("group", { name: family })).toBeVisible();
  await expect(types.getByRole("group", { name: "Problems" }).getByRole("button")).toHaveText([/^Fault/, /^Symptom/]);
  await expect(page.getByText("Colour shows the family; the shape and the name tell the types apart.")).toBeVisible();
  // Filtering removes a type from the scene too.
  await types.getByRole("button", { name: /^Document/ }).click();
  await expect(page.locator(".kn-3d__label--doc")).toHaveCount(0);
  await expect(page.locator(".kn-count")).toHaveText(/122 nodes/);
});

test("choosing a node in 3D flies to it, lights what it relates to and explains it", async ({ page }) => {
  await open(page, "?kv=graph");
  await expect(scene(page).locator("canvas")).toBeVisible();
  // A name over the canvas is a target too.
  await name3d(page, "ent_equipment_chiller").click();
  await expect(page).toHaveURL(/node=ent_equipment_chiller/);
  await expect(scene(page)).toHaveAttribute("data-selected", "ent_equipment_chiller");
  await expect(name3d(page, "ent_equipment_chiller")).toHaveClass(/kn-3d__label--on/);
  await expect.poll(() => centreOffset(page, "ent_equipment_chiller")).toBeLessThan(40);
  // What it relates to keeps its colour and its name; the rest fades (and only documents,
  // faded, keep their names to show where the clusters are).
  expect(await page.locator(".kn-3d__label[data-show]:not(.kn-3d__label--dim)").count()).toBeGreaterThan(5);
  await expect(page.locator(".kn-3d__label--dim[data-show]:not(.kn-3d__label--doc)")).toHaveCount(0);
  await expect(page.locator(".kn-3d__label--dim").first()).toBeAttached();
  await expect(panel(page).getByRole("heading", { name: "Chiller" })).toBeVisible();
  await expect(panel(page)).toContainText("Recognised in the indexed text by the HVAC vocabulary rules, not by a model.");
  // Clicking empty space clears the choice.
  await scene(page).scrollIntoViewIfNeeded();
  const box = (await scene(page).boundingBox())!;
  let empty: { x: number; y: number } | null = null;
  for (const [fx, fy] of [[0.05, 0.9], [0.95, 0.9], [0.05, 0.3], [0.5, 0.95]]) {
    await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
    await page.waitForTimeout(150);
    if (!(await scene(page).getAttribute("data-hover"))) {
      empty = { x: box.x + box.width * fx, y: box.y + box.height * fy };
      break;
    }
  }
  await page.mouse.click(empty!.x, empty!.y);
  await expect(page).not.toHaveURL(/node=/);
});

test("find takes the 3D view to a node, and the view can be fitted and reset", async ({ page }) => {
  await open(page, "?kv=graph");
  await expect(scene(page).locator("canvas")).toBeVisible();
  await page.getByRole("searchbox", { name: "Find a node" }).fill("condenser tube fou");
  await page.getByRole("searchbox", { name: "Find a node" }).press("Enter");
  await expect(page).toHaveURL(/node=ent_fault_condenser_fouling/);
  await expect.poll(() => centreOffset(page, "ent_fault_condenser_fouling")).toBeLessThan(40);
  await expect(page.locator('.kn-3d__label--doc[data-show]')).not.toHaveCount(6);
  // Reset returns to the overview, where every document is named again.
  await page.getByRole("button", { name: "Close panel" }).click();
  await page.getByRole("button", { name: "Reset view" }).click();
  await settled(page);
  await expect(page.locator('.kn-3d__label--doc[data-show]')).toHaveCount(6);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await settled(page);
  await expect(page.locator('.kn-3d__label--doc[data-show]')).toHaveCount(6);
});

test("the 3D graph is usable from the keyboard, and focus comes back to it", async ({ page }) => {
  await open(page, "?kv=graph");
  await expect(scene(page).locator("canvas")).toBeVisible();
  await scene(page).focus();
  const first = await scene(page).getAttribute("data-focused");
  expect(first).toBeTruthy();
  await expect(page.locator(".kn-3d-frame [aria-live]")).toContainText("Enter inspects it.");
  await page.keyboard.press("ArrowRight");
  await expect(scene(page)).not.toHaveAttribute("data-focused", first!);
  const focused = (await scene(page).getAttribute("data-focused"))!;
  // Shift turns the view; + zooms; neither loses the place.
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("+");
  await expect(scene(page)).toHaveAttribute("data-focused", focused);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`node=${focused}`));
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/node=/);
  await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains("kn-3d"))).toBe(true);
});

test("3D and 2D are two views of one graph and one address", async ({ page }) => {
  await open(page, "?kv=graph&node=ent_fault_condenser_fouling");
  await expect(scene(page)).toHaveAttribute("data-selected", "ent_fault_condenser_fouling");
  await page.getByRole("radio", { name: "2D" }).click();
  await expect(page).toHaveURL(/gv=2d/);
  await expect(page).toHaveURL(/node=ent_fault_condenser_fouling/);
  const flat = page.getByRole("group", { name: /Knowledge graph, \d+ nodes/ });
  await expect(flat.locator('[data-node-id="ent_fault_condenser_fouling"]')).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("radio", { name: "3D" }).click();
  await expect(page).not.toHaveURL(/gv=/);
  await expect(scene(page)).toHaveAttribute("data-selected", "ent_fault_condenser_fouling");
});

test("the 3D view draws only while someone looks around", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { draws: number };
    w.draws = 0;
    for (const proto of [WebGL2RenderingContext.prototype, WebGLRenderingContext.prototype]) {
      const draw = proto.drawElements;
      proto.drawElements = function (...args: Parameters<typeof draw>) {
        w.draws++;
        return draw.apply(this, args);
      };
    }
  });
  await open(page, "?kv=graph");
  await expect(scene(page).locator("canvas")).toBeVisible();
  const draws = () => page.evaluate(() => (window as unknown as { draws: number }).draws);
  await expect.poll(draws).toBeGreaterThan(0);
  // Idle: after a moment it stops drawing altogether.
  await expect
    .poll(
      async () => {
        const before = await draws();
        await page.waitForTimeout(600);
        return (await draws()) - before;
      },
      { timeout: 10_000 },
    )
    .toBe(0);
  // Looking round wakes it.
  const box = (await scene(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(draws).toBeGreaterThan(0);
});

test("without WebGL the graph is drawn in 2D and says why", async ({ page }) => {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      return type.startsWith("webgl") ? null : (get as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof get;
  });
  await open(page, "?kv=graph");
  await expect(page.getByText("This browser cannot draw in 3D (WebGL is unavailable), so the graph is shown in 2D.")).toBeVisible();
  await expect(page.getByRole("radio", { name: "3D" })).toBeDisabled();
  await expect(page.getByRole("group", { name: /Knowledge graph, \d+ nodes/ }).locator(".kn-node")).toHaveCount(128);
});

test("high-contrast mode opens the graph in 2D, and 3D stays a choice", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await open(page, "?kv=graph");
  await expect(page.getByText(/High-contrast mode is on, so the graph opens in 2D/)).toBeVisible();
  await expect(page.getByRole("group", { name: /Knowledge graph, \d+ nodes/ }).locator(".kn-node").first()).toBeVisible();
  await page.getByRole("radio", { name: "3D" }).click();
  await expect(page).toHaveURL(/gv=3d/);
  await expect(scene(page).locator("canvas")).toBeVisible();
});

test("Graph Memory: a timeline with provenance, corrections kept as history, and the memory graph", async ({ page }) => {
  await open(page, "?kn=memory");
  await expect(page.getByText("12 current records · 1 superseded versions · 9 links")).toBeVisible();
  await expect(page.getByText(/The demo records are fixed/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Record memory" })).toHaveCount(0);
  const entries = page.locator(".kn-entry");
  await expect(entries).toHaveCount(12);
  await expect(entries.first()).toContainText("CW pump 4 vibration 2.1 mm/s during the rotation run");
  const simulated = page.locator(".kn-entry").filter({ has: page.locator(".kn-entry__title", { hasText: "Simulated cleaning" }) });
  await expect(simulated.locator(".tag-chip")).toHaveText("Simulation · RUN-0002");
  // Filters: equipment, then superseded versions too.
  await page.getByRole("combobox", { name: "Equipment" }).selectOption("chiller_plant_2");
  await expect(entries).toHaveCount(7);
  await expect(entries.first()).toContainText("After “Chiller 2 condenser tubes cleaned and returned to service” on Chiller 2");
  await page.getByRole("checkbox", { name: "Include superseded versions" }).check();
  await expect(entries).toHaveCount(8);
  const old = page.locator(".kn-entry--old");
  await expect(old).toContainText("Chiller 2 condenser approach 4.8 K at 70% load");
  await old.click();
  await expect(panel(page)).toContainText("Until 2026-09-29 10:15 UTC, then corrected.");
  await expect(panel(page).locator(".kn-history li")).toHaveCount(2);
  await panel(page).getByRole("button", { name: "Open the current version" }).click();
  await expect(panel(page).getByRole("heading", { name: "Chiller 2 condenser approach 4.2 K at 70% load" })).toBeVisible();
  await expect(panel(page)).toContainText("Reason: The leaving condenser water sensor read 0.6 K low");
  await expect(panel(page)).toContainText("Supports");
  // The memory graph: the same records on a time axis.
  await page.getByRole("radio", { name: "Graph" }).click();
  const canvas = page.getByRole("group", { name: /Memory graph in time/ });
  await expect(canvas).toBeVisible();
  await expect(canvas.locator('.kn-node[data-type="equipment"]')).toHaveCount(1);
  await expect(canvas.locator(".kn-edge--derived").first()).toBeAttached();
  await canvas.locator('[data-node-id="mem_demo004"]').click();
  await expect(panel(page).getByRole("heading", { name: "Condenser tube fouling likely on Chiller 2" })).toBeVisible();
  await expect(panel(page)).toContainText("Resolved by");
});

test("a failing or empty service is shown as such, never filled in", async ({ page }) => {
  await open(page, "?fail=knowledge:unavailable");
  await expect(page.getByRole("alert").filter({ hasText: "The library could not be loaded." })).toBeVisible();
  await open(page, "?fail=knowledge:empty");
  await expect(page.getByText("The demo library is empty (fail=knowledge:empty).")).toBeVisible();
  await open(page, "?kn=memory&fail=memory:unavailable");
  await expect(page.getByRole("alert").filter({ hasText: "Memory could not be loaded." })).toBeVisible();
});

test("leaving the page drops its own address but keeps the data context", async ({ page }) => {
  await open(page, "?scenario=tower-fault&kn=memory&mem=mem_demo004");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Engineering", exact: true }).click();
  await expect(page).toHaveURL(/\/engineering\?scenario=tower-fault$/);
});

test("with reduced motion nothing moves", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "?kv=graph&node=ent_fault_condenser_fouling");
  await expect(panel(page)).toBeVisible();
  // The 3D camera is at the chosen node at once, without flying.
  await expect(name3d(page, "ent_fault_condenser_fouling")).toHaveAttribute("data-show", "");
  await expect.poll(() => centreOffset(page, "ent_fault_condenser_fouling")).toBeLessThan(40);
  expect(await page.evaluate(() => document.documentElement.dataset.motion ?? null)).toBeNull();
  await tab(page, "Graph Memory").click();
  await expect(page.locator(".kn-entry").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dataset.motion ?? null)).toBeNull();
});

test("no horizontal overflow on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const q of ["", "?kv=search&q=fouling", "?kv=graph", "?kn=memory", "?kn=memory&mem=mem_demo004"]) {
    await open(page, q);
    await settled(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  }
});

test("no serious accessibility violations across the workspace", async ({ page }) => {
  test.slow();
  for (const q of [
    "",
    "?doc=doc_332e294219eb",
    "?kv=search&q=" + encodeURIComponent("What are the common causes of low chiller COP?"),
    "?kv=graph&node=ent_fault_condenser_fouling",
    "?kv=graph&gv=2d&node=ent_fault_condenser_fouling",
    "?kn=memory&mem=mem_demo004",
    "?kn=memory&mv=graph",
  ]) {
    await open(page, q);
    await expect(page.locator(".kn-loading")).toHaveCount(0);
    expect(await serious(page), q).toEqual([]);
  }
});
