/**
 * M7: the Knowledge workspace in demo mode. The RAG Graph over the fixed demo library
 * (synthetic documents indexed by the real rule-based pipeline when the snapshot was made)
 * and Graph Memory over the fixed demo records: tabs, the graph filling the page with its
 * controls over it (M7.3), the library and the passage search beside it, documents, the
 * source reader, search with its evidence, the knowledge graph in 3D (WebGL, drawn by
 * SwiftShader in headless Chromium) and 2D, the memory timeline and graph, failures,
 * keyboard, reduced motion and accessibility. The local services are covered by
 * knowledge-local.spec.
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
// Headless Chromium draws WebGL in software (SwiftShader), which starts with a browser's first
// WebGL context: about two seconds alone, more while other workers start theirs, then a few
// milliseconds per context. Started here, once per worker, it is not charged to whichever
// test happens to draw first.
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.evaluate(() => document.createElement("canvas").getContext("webgl2"));
  await page.close();
});
const tab = (page: Page, name: "RAG Graph" | "Graph Memory") => page.getByRole("tab", { name });
const panel = (page: Page) => page.locator(".kn-panel");
/** The graph's one search box: a node by name, or the passages for the words typed. */
const searchBox = (page: Page) => page.getByRole("combobox", { name: "Search nodes and passages" });
/** Types in the search box and takes the first choice: a node whose name matches, else the
 *  passages. */
async function find(page: Page, text: string) {
  await searchBox(page).fill(text);
  await searchBox(page).press("Enter");
}
/** The search box's choices (not the deck's own select options). */
const choices = (page: Page) => page.getByRole("listbox", { name: "Matches" }).getByRole("option");
/** The button over the graph that opens (and closes) the filters with the legend. */
const filters = (page: Page) => page.getByRole("button", { name: /^Filters/ });

async function open(page: Page, query = "") {
  await page.goto(`/knowledge${query}`);
  await expect(page.getByRole("heading", { level: 1, name: "Knowledge" })).toBeVisible();
  // The heading is the app's, there before the workspace has loaded: wait for the workspace.
  await expect(page.getByRole("tablist", { name: "Knowledge systems" })).toBeVisible();
}
async function serious(page: Page) {
  await settled(page);
  const results = await new AxeBuilder({ page }).include(".knowledge").analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
}

test("Knowledge opens on the RAG Graph, with Graph Memory as the other tab and no second destination", async ({ page }) => {
  await open(page);
  await expect(tab(page, "RAG Graph")).toHaveAttribute("aria-selected", "true");
  await expect(tab(page, "Graph Memory")).toHaveAttribute("aria-selected", "false");
  await expect(page.getByText("Demo library, read only")).toBeVisible();
  // The graph at once: no Library, Search and Graph views to choose between, no lead
  // paragraph; the header counts what the graph shows.
  await expect(scene(page).locator("canvas")).toBeVisible();
  await expect(page.getByRole("radio", { name: /^(Library|Search|Graph)$/ })).toHaveCount(0);
  await expect(page.locator(".knowledge__lead")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "128 nodes, 252 relationships" })).toBeVisible();
  // The dock keeps its four sections; Graph Memory has no destination of its own.
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.getByRole("link", { name: "Knowledge", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: /memory/i })).toHaveCount(0);
  // Arrow keys move between the tabs; the address keeps the tab.
  await tab(page, "RAG Graph").focus();
  await page.keyboard.press("ArrowRight");
  await expect(tab(page, "Graph Memory")).toBeFocused();
  await expect(page).toHaveURL(/kn=memory/);
  await expect(page.getByText("Demo records, read only")).toBeVisible();
  await page.goBack();
  await expect(tab(page, "RAG Graph")).toHaveAttribute("aria-selected", "true");
});

test("the RAG Graph fills the display, with its controls over it and nothing to scroll", async ({ page }) => {
  test.slow();
  for (const [size, least] of [
    [{ width: 1440, height: 900 }, 0.8],
    [{ width: 390, height: 844 }, 0.7],
  ] as const) {
    await page.setViewportSize(size);
    for (const q of ["", "?kv=library", "?kv=search&q=fouling", "?node=ent_fault_condenser_fouling"]) {
      await open(page, q);
      await expect(scene(page).locator("canvas")).toBeVisible();
      await settled(page);
      const m = await page.evaluate(() => {
        const main = document.querySelector(".main")!.getBoundingClientRect();
        const graph = document.querySelector(".kn-graphview")!.getBoundingClientRect();
        const view = document.querySelector(".main__view")!;
        const boxes = (s: string) => [...document.querySelectorAll(s)].map((e) => e.getBoundingClientRect()).filter((r) => r.width);
        const others = boxes(".kn-canvas__tools, .kn-3d__trail");
        return {
          share: (graph.width * graph.height) / (main.width * main.height),
          inView: graph.top >= main.top && graph.bottom <= Math.min(innerHeight, main.bottom) + 1,
          scroll: [view.scrollHeight - view.clientHeight, document.documentElement.scrollHeight - innerHeight, document.documentElement.scrollWidth - innerWidth],
          overlap: boxes(".kn-hud > *").some((a) => others.some((b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)),
        };
      });
      const at = `${size.width}px ${q || "(graph)"}`;
      expect(m.inView, at).toBe(true);
      expect(m.scroll, at).toEqual([0, 0, 0]);
      expect(m.overlap, at).toBe(false);
      // Alone, the graph takes nearly the whole display.
      if (!q) expect(m.share, at).toBeGreaterThan(least);
    }
  }
  // The canvas follows the window as it resizes.
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await expect(scene(page).locator("canvas")).toBeVisible();
  const fit = () => page.evaluate(() => Math.abs(document.querySelector(".kn-3d canvas")!.getBoundingClientRect().width - document.querySelector(".kn-3d")!.getBoundingClientRect().width));
  const before = (await scene(page).boundingBox())!.width;
  await page.setViewportSize({ width: 1700, height: 1000 });
  await expect.poll(async () => (await scene(page).boundingBox())!.width).toBeGreaterThan(before + 100);
  await expect.poll(fit).toBeLessThan(2);
});

test("the library opens beside the graph: what was indexed and what failed, and the demo library is fixed", async ({ page }) => {
  await open(page);
  await expect(scene(page).locator("canvas")).toBeVisible();
  const width = async () => (await scene(page).boundingBox())!.width;
  const full = await width();
  const library = page.getByRole("button", { name: "Library" });
  await expect(library).toHaveAttribute("aria-pressed", "false");
  await library.click();
  await expect(page).toHaveURL(/kv=library/);
  await expect(library).toHaveAttribute("aria-pressed", "true");
  const drawer = page.getByRole("complementary", { name: "Document library" });
  await expect(drawer.getByRole("heading", { name: "Document library" })).toBeFocused();
  // The graph stays beside it, narrower.
  await expect.poll(width).toBeLessThan(full * 0.8);
  const table = drawer.locator(".kn-docs");
  await expect(table.locator("tbody tr")).toHaveCount(7);
  await expect(drawer.getByText("7 documents · 29 passages")).toBeVisible();
  const failed = table.locator("tr", { hasText: "Demo drawing register" });
  await expect(failed).toContainText("Failed");
  await expect(failed).toContainText("The file has no text to index.");
  await expect(table.locator("tr", { hasText: "Demo chiller maintenance guide" })).toContainText("Indexed");
  // What the service can and cannot do, as facts.
  const caps = drawer.locator(".kn-caps");
  await expect(caps).toContainText("Demo snapshot, read only");
  await expect(caps).toContainText("PDF not configured");
  await expect(caps).toContainText("Rule-based HVAC vocabulary");
  await expect(caps).toContainText("Not generated: no language model is configured");
  // No management in the demo, and the reason is given.
  await expect(page.getByRole("button", { name: "Add document" })).toHaveCount(0);
  await expect(drawer.getByText(/The demo library is fixed/)).toBeVisible();
  // Closed, it gives the graph its room back; focus returns to the button that opened it.
  await drawer.getByRole("button", { name: "Close panel" }).click();
  await expect(page).not.toHaveURL(/kv=/);
  await expect(drawer).toHaveCount(0);
  await expect(library).toBeFocused();
  await expect.poll(width).toBeGreaterThan(full * 0.95);
});

test("a document chosen in the library focuses its group, shows its stages and outline, and its sections open in the source reader", async ({ page }) => {
  await open(page, "?kv=library");
  await page.locator(".kn-docs").getByRole("button", { name: "Demo site procedure: Chiller 2 condenser tube cleaning" }).click();
  await expect(panel(page).getByRole("heading", { name: "Demo site procedure: Chiller 2 condenser tube cleaning" })).toBeFocused();
  // Its group in the graph is focused, beside it.
  const id = /doc=(doc_\w+)/.exec(page.url())![1];
  await expect(scene(page)).toHaveAttribute("data-mode", "group");
  await expect(scene(page)).toHaveAttribute("data-group", id);
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
  // Escape closes the reader: the library is there again, with focus on it.
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Document library" })).toBeFocused();
  await expect(page).toHaveURL(/kv=library/);
  // "Back to the library" does the same from a document.
  await page.locator(".kn-docs").getByRole("button", { name: "Demo chiller maintenance guide" }).click();
  await expect(panel(page).getByRole("heading", { name: "Demo chiller maintenance guide" })).toBeVisible();
  await page.getByRole("button", { name: "Back to the library" }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.locator(".kn-docs")).toBeVisible();
  await expect(page.locator(".kn-docs").getByRole("button", { name: "Demo chiller maintenance guide" })).toBeFocused();
});

test("a citation that no longer resolves says so", async ({ page }) => {
  await open(page, "?passage=chk_000000000000_0001");
  await expect(panel(page).getByRole("heading", { name: "Passage unavailable" })).toBeVisible();
  await expect(panel(page)).toContainText("its document was removed or reindexed");
  await open(page, "?doc=doc_000000000000");
  await expect(panel(page)).toContainText("no longer in the library");
});

test("search returns stored passages with their source and how each was found, and writes no answer", async ({ page }) => {
  await open(page);
  // A question names no node: its one choice in the search box is the passages.
  await searchBox(page).fill("What are the common causes of low chiller COP?");
  await expect(page.getByText("No node in view has that name: search the passages instead.")).toBeVisible();
  await expect(choices(page)).toHaveText([/Search passages for “What are the common causes of low chiller COP\?”/]);
  await searchBox(page).press("Enter");
  await expect(page).toHaveURL(/kv=search&q=What/);
  await expect(page.getByRole("complementary", { name: "Passages for “What are the common causes of low chiller COP?”" })).toBeVisible();
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
  // The passage opens at its source, exactly as stored; the results are a step back.
  await top.getByRole("button", { name: "Read passage" }).click();
  await expect(panel(page).locator(".kn-passage")).toContainText("Condenser tube fouling insulates the tubes");
  await page.getByRole("button", { name: "Back to the results" }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(results.first()).toBeVisible();
  await expect(top.getByRole("button", { name: "Read passage" })).toBeFocused();
  // Further down the list: it keeps its place under the passage.
  const column = page.locator(".kn-column");
  const third = results.nth(2);
  await third.getByRole("button", { name: "Read passage" }).scrollIntoViewIfNeeded();
  const place = await column.evaluate((el) => el.scrollTop);
  expect(place).toBeGreaterThan(0);
  await third.getByRole("button", { name: "Read passage" }).click();
  await expect(panel(page).locator(".kn-passage")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(third.getByRole("button", { name: "Read passage" })).toBeFocused();
  expect(await column.evaluate((el) => el.scrollTop)).toBe(place);
  // Questions about procedures find the Chiller 2 procedure first.
  await find(page, "What maintenance procedures relate to Chiller 2?");
  await expect(results.first()).toContainText("Demo site procedure: Chiller 2 condenser tube cleaning");
  await expect(results.first().locator(".tag-chip", { hasText: "Procedure" })).toBeVisible();
  // Nothing matches: said plainly.
  await find(page, "zeppelin");
  await expect(page.getByText(/No indexed passage matches “zeppelin”/)).toBeVisible();
});

test("the passage search starts from examples, and a result's section is shown in the graph, or said to be missing from it", async ({ page }) => {
  // The empty search box offers the example questions; none is taken until the arrows reach it.
  await open(page);
  await searchBox(page).focus();
  const examples = page.getByRole("listbox", { name: "Example questions" }).getByRole("option");
  await expect(examples).toHaveText(["What are the common causes of low chiller COP?", "Which documents discuss cooling tower performance?", "What maintenance procedures relate to Chiller 2?"]);
  await searchBox(page).press("Enter");
  await expect(page).not.toHaveURL(/kv=search/);
  await searchBox(page).press("ArrowDown");
  await expect(examples.first()).toHaveAttribute("aria-selected", "true");
  await searchBox(page).press("Enter");
  await expect(page).toHaveURL(/kv=search&q=What/);
  await expect(page.locator(".kn-hit").first()).toContainText("Common causes of low COP");
  // Opened without a question, the column explains the search and offers them too.
  await open(page, "?kv=search");
  await expect(page.getByText(/Type a question in the search box/)).toBeVisible();
  await page.getByRole("button", { name: "What are the common causes of low chiller COP?" }).click();
  const top = page.locator(".kn-hit").first();
  await expect(top).toContainText("Common causes of low COP");
  await expect(top).not.toContainText("not in the graph view");
  // Show in graph: its section is chosen there, the results a step back.
  await top.getByRole("button", { name: "Show in graph" }).click();
  await expect(page).toHaveURL(/node=sec_/);
  const section = /node=(sec_\w+)/.exec(page.url())![1];
  await expect(scene(page)).toHaveAttribute("data-selected", section);
  await page.getByRole("button", { name: "Back to the results" }).click();
  // With sections filtered out of the view, a result says its section is not in the graph;
  // showing it adds it.
  await filters(page).click();
  await page.getByRole("group", { name: "Show node types" }).getByRole("button", { name: /^Section/ }).click();
  await expect(top).toContainText("Its section is not in the graph view; showing it adds it.");
  await top.getByRole("button", { name: "Show in graph" }).click();
  await expect(scene(page)).toHaveAttribute("data-selected", section);
  await expect(page.locator(`.kn-3d__label[data-node-id="${section}"]`)).toBeAttached();
});

test("the search box finds a node by name and flies to it, apart from searching the passages", async ({ page }) => {
  await open(page);
  await expect(scene(page).locator("canvas")).toBeVisible();
  const box = searchBox(page);
  await box.fill("chill");
  const options = choices(page);
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await expect(options.first()).toContainText("Equipment");
  await expect(options.last()).toHaveText(/Search passages for “chill”/);
  // Arrows move through the choices; Escape closes the list and keeps the words.
  await box.press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(box).toHaveAttribute("aria-activedescendant", (await options.nth(1).getAttribute("id"))!);
  await box.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(box).toHaveValue("chill");
  await expect(page).not.toHaveURL(/kv=|node=/);
  // A node: the camera flies to it and it is inspected; the box is cleared.
  await box.press("ArrowDown");
  await options.filter({ hasText: /^Chiller 2/ }).click();
  await expect(page).toHaveURL(/node=ent_equipment_chiller_plant_2/);
  await expect(scene(page)).toHaveAttribute("data-selected", "ent_equipment_chiller_plant_2");
  await expect.poll(() => centreOffset(page, "ent_equipment_chiller_plant_2")).toBeLessThan(40);
  await expect(panel(page).getByRole("heading", { name: "Chiller 2" })).toBeVisible();
  await expect(box).toHaveValue("");
});

test("the 2D knowledge graph filters, finds, inspects and shows the evidence behind a relationship", async ({ page }) => {
  await open(page, "?gv=2d");
  const canvas = page.getByRole("group", { name: /Knowledge graph, \d+ nodes/ });
  await expect(canvas).toBeVisible();
  await expect(page.locator(".kn-count", { hasText: "128 nodes" })).toBeVisible();
  await expect(canvas.locator(".kn-node")).toHaveCount(128);
  // Filter by type.
  await filters(page).click();
  const types = page.getByRole("group", { name: "Show node types" });
  await types.getByRole("button", { name: /^Section/ }).click();
  await expect(types.getByRole("button", { name: /^Section/ })).toHaveAttribute("aria-pressed", "false");
  await expect(canvas.locator('.kn-node[data-type="section"]')).toHaveCount(0);
  await types.getByRole("button", { name: /^Section/ }).click();
  // Find a node and inspect it.
  await searchBox(page).fill("condenser tube fou");
  await choices(page).filter({ hasText: "Condenser tube fouling" }).click();
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
  await open(page, "?gv=2d");
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
/** Where the node under the keyboard ring is in the 3D view (the ring is drawn exactly over
 *  it), relative to the view's corner; NaN until it has been drawn. */
async function marked(page: Page) {
  return page.locator(".kn-3d__ring").evaluate((el: HTMLElement) => {
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform);
    const d = parseFloat(el.style.width);
    return m ? { x: Number(m[1]) + d / 2, y: Number(m[2]) + d / 2, d } : { x: NaN, y: NaN, d: NaN };
  });
}
/** The same, once the view has stopped moving (a drag ends in a short glide). */
async function resting(page: Page) {
  let last = await marked(page);
  for (;;) {
    await page.waitForTimeout(250);
    const now = await marked(page);
    if (Math.hypot(now.x - last.x, now.y - last.y) < 0.5) return now;
    last = now;
  }
}
async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number, button: "left" | "right" = "left") {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + (dx * i) / 8, from.y + (dy * i) / 8);
  await page.mouse.up({ button });
}
/** How far apart the documents' names are across the view. */
const spread = (page: Page) =>
  page.locator(".kn-3d__label--doc[data-show]").evaluateAll((els) => {
    const xs = els.map((e) => e.getBoundingClientRect()).map((r) => r.x + r.width / 2);
    return Math.max(...xs) - Math.min(...xs);
  });

test("the knowledge graph opens in 3D, clustered by document, with its families as the legend", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("radio", { name: "3D" })).toHaveAttribute("aria-checked", "true");
  await expect(scene(page).locator("canvas")).toBeVisible();
  // Every document names its group; nothing else crowds the overview.
  await expect(page.locator('.kn-3d__label--doc[data-show]')).toHaveCount(6);
  expect(await page.locator(".kn-3d__label[data-show]").count()).toBeLessThan(16);
  // The groups stand well apart on screen.
  const centres = await page.locator(".kn-3d__label--doc[data-show]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.left + r.width / 2, r.top] as const));
  for (const [i, a] of centres.entries()) for (const b of centres.slice(i + 1)) expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(150);
  // The legend, under Filters: four families, colour on the glyph, every type a filter.
  await expect(filters(page)).toHaveAttribute("aria-expanded", "false");
  await filters(page).click();
  await expect(filters(page)).toHaveAttribute("aria-expanded", "true");
  const types = page.getByRole("group", { name: "Show node types" });
  for (const family of ["Sources", "Plant and process", "Problems", "Guidance"]) await expect(types.getByRole("group", { name: family })).toBeVisible();
  await expect(types.getByRole("group", { name: "Problems" }).getByRole("button")).toHaveText([/^Fault/, /^Symptom/]);
  await expect(page.getByText("Colour shows the family; the shape and the name tell the types apart.")).toBeVisible();
  // Filtering removes a type from the scene too; the button says how many are hidden.
  await types.getByRole("button", { name: /^Document/ }).click();
  await expect(page.locator(".kn-3d__label--doc")).toHaveCount(0);
  await expect(page.locator(".kn-count")).toHaveText(/122 nodes/);
  await expect(filters(page)).toHaveAccessibleName("Filters (1 hidden)");
  // Escape closes the filters, and only them.
  await page.keyboard.press("Escape");
  await expect(types).toHaveCount(0);
  await expect(filters(page)).toHaveAttribute("aria-expanded", "false");
});

test("Help holds how to move round the graph, which the canvas also carries as its description", async ({ page }) => {
  await open(page);
  await expect(scene(page).locator("canvas")).toBeVisible();
  // No instructions printed under the graph any more: they are its accessible description.
  const hint = (await page.locator(".kn-3d-frame .kn-canvas__hint").boundingBox())!;
  expect(hint.width * hint.height).toBeLessThanOrEqual(1);
  await expect(scene(page)).toHaveAccessibleDescription(/right-drag or Shift-drag to turn it/);
  const help = page.getByRole("button", { name: "Help" });
  await help.click();
  const box = page.getByRole("region", { name: "Using the RAG Graph" });
  await expect(box).toContainText("Drag to move the graph");
  await expect(box).toContainText("Keys: arrows move between nodes");
  await expect(box).toContainText("“Search passages” searches the indexed text");
  await expect(box).toContainText("Library lists the indexed documents");
  // Escape, or a press elsewhere, closes it.
  await page.keyboard.press("Escape");
  await expect(box).toHaveCount(0);
  await help.click();
  await page.locator(".kn-count").click();
  await expect(box).toHaveCount(0);
});

test("overview, a document's group, a node in it, a relationship, and back by the trail", async ({ page }) => {
  await open(page);
  await expect(scene(page).locator("canvas")).toBeVisible();
  const trail = page.getByRole("navigation", { name: "Graph focus" });
  await expect(trail).toHaveCount(0);
  // A document (its planet or its name) focuses its whole group.
  await name3d(page, "doc_6479a9d1fdaf").click();
  await expect(page).toHaveURL(/node=doc_6479a9d1fdaf/);
  await expect(scene(page)).toHaveAttribute("data-mode", "group");
  await expect(scene(page)).toHaveAttribute("data-group", "doc_6479a9d1fdaf");
  await expect(trail.locator('[aria-current="location"]')).toHaveText("Demo chiller maintenance guide");
  // Its members are named; the other groups stay in view, faded.
  await expect.poll(() => page.locator('.kn-3d__label[data-show][data-home="doc_6479a9d1fdaf"]').count()).toBeGreaterThan(8);
  await expect(page.locator(".kn-3d__label--doc.kn-3d__label--dim").first()).toBeAttached();
  // A member: the camera comes to it, its relationships light up, the rest fades.
  await name3d(page, "ent_equipment_chiller").click();
  await expect(page).toHaveURL(/node=ent_equipment_chiller/);
  await expect(scene(page)).toHaveAttribute("data-mode", "node");
  await expect(scene(page)).toHaveAttribute("data-selected", "ent_equipment_chiller");
  await expect(name3d(page, "ent_equipment_chiller")).toHaveClass(/kn-3d__label--on/);
  await expect.poll(() => centreOffset(page, "ent_equipment_chiller")).toBeLessThan(40);
  expect(await page.locator(".kn-3d__label[data-show]:not(.kn-3d__label--dim)").count()).toBeGreaterThan(5);
  // Faded names belong to its own group, or are documents.
  for (const home of await page.locator(".kn-3d__label--dim[data-show]:not(.kn-3d__label--doc)").evaluateAll((els) => els.map((e) => e.getAttribute("data-home"))))
    expect(home).toBe("doc_6479a9d1fdaf");
  await expect(panel(page).getByRole("heading", { name: "Chiller" })).toBeVisible();
  await expect(panel(page)).toContainText("Recognised in the indexed text by the HVAC vocabulary rules, not by a model.");
  await expect(trail.locator('[aria-current="location"]')).toHaveText("Chiller");
  // One of its relationships: both ends framed, the trail names it.
  await panel(page).locator(".kn-rel").first().click();
  await expect(page).toHaveURL(/edge=rel_/);
  await expect(scene(page)).toHaveAttribute("data-mode", "edge");
  // Back up the trail: the group, then the overview with every group named again.
  await trail.getByRole("button", { name: /Demo chiller maintenance/ }).click();
  await expect(page).toHaveURL(/node=doc_6479a9d1fdaf/);
  await trail.getByRole("button", { name: "Overview" }).click();
  await expect(page).not.toHaveURL(/node=|edge=/);
  await expect(scene(page)).toHaveAttribute("data-mode", "overview");
  await expect(trail).toHaveCount(0);
  await expect(page.locator(".kn-3d__label--doc[data-show]")).toHaveCount(6);
  // Clicking empty space clears a choice.
  await find(page, "chiller 2");
  await expect(page).toHaveURL(/node=ent_equipment_chiller_plant_2/);
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

test("clicking a document's sphere focuses its group", async ({ page }) => {
  await open(page);
  await expect(scene(page).locator("canvas")).toBeVisible();
  await scene(page).scrollIntoViewIfNeeded();
  // The planet sits just above its name: find it by what the pointer is over.
  const name = (await name3d(page, "doc_98c1a7b7adaf").boundingBox())!;
  let found = false;
  for (let dy = 8; dy <= 60 && !found; dy += 4) {
    await page.mouse.move(name.x + name.width / 2, name.y - dy);
    found = await expect
      .poll(() => scene(page).getAttribute("data-hover"), { timeout: 400 })
      .toBe("doc_98c1a7b7adaf")
      .then(() => true, () => false);
  }
  expect(found).toBe(true);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page).toHaveURL(/node=doc_98c1a7b7adaf/);
  await expect(scene(page)).toHaveAttribute("data-mode", "group");
  await expect(page.getByRole("navigation", { name: "Graph focus" }).locator('[aria-current="location"]')).toContainText("Demo site note");
});

// The camera tests measure where things end up, so they run with reduced motion: no glide after
// a drag and no flights, nothing still settling when a position is read.
test("the 3D graph moves like a map: drag pans, right-drag turns, the wheel zooms to the pointer, and a drag chooses nothing", async ({ page }) => {
  test.slow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await expect(scene(page).locator("canvas")).toBeVisible();
  await scene(page).scrollIntoViewIfNeeded();
  await settled(page);
  await scene(page).focus();
  const box = (await scene(page).boundingBox())!;
  const from = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.5 };
  // The press lands on the graph's canvas: the stars behind it take no events.
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [from.x, from.y])).toBe("CANVAS");
  await expect(page.locator(".kn-3d__sky")).toHaveCSS("pointer-events", "none");
  const wide = await spread(page);
  // Dragging moves the graph with the cursor, and chooses nothing.
  let before = await resting(page);
  await drag(page, from, 150, 80);
  await expect.poll(async () => ((m) => Math.hypot(m.x - before.x - 150, m.y - before.y - 80))(await marked(page))).toBeLessThan(15);
  await expect(page).not.toHaveURL(/node=/);
  // So does a drag that starts on a name.
  const name = (await name3d(page, "doc_6846dc086ef9").boundingBox())!;
  before = await resting(page);
  await drag(page, { x: name.x + name.width / 2, y: name.y + name.height / 2 }, -90, 50);
  await expect.poll(async () => ((m) => Math.hypot(m.x - before.x + 90, m.y - before.y - 50))(await marked(page))).toBeLessThan(15);
  await expect(page).not.toHaveURL(/node=/);
  // Fit brings the whole graph back, still from the front.
  await page.getByRole("button", { name: "Fit" }).click();
  await expect.poll(() => spread(page)).toBeGreaterThan(wide * 0.95);
  // Right-drag turns the view: the names close up as it swings round.
  await drag(page, from, 120, 0, "right");
  await expect.poll(() => spread(page)).toBeLessThan(wide * 0.8);
  await expect(page).not.toHaveURL(/node=/);
  // Reset view returns to the view it opened with.
  await page.getByRole("button", { name: "Reset view" }).click();
  await expect.poll(async () => Math.abs((await spread(page)) - wide)).toBeLessThan(wide * 0.03);
  // The wheel zooms in towards the pointer: the node under it grows and stays under it.
  before = await resting(page);
  await page.mouse.move(box.x + before.x, box.y + before.y);
  await page.mouse.wheel(0, -900);
  await expect.poll(async () => (await marked(page)).d).toBeGreaterThan(before.d * 1.15);
  const after = await resting(page);
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(16);
});

test("a view moved after choosing stays put when the choice's neighbours arrive later", async ({ page }) => {
  test.slow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  // The demo service answers after a simulated 120 ms; while `hold` is set, its answers wait,
  // as a slow service's would.
  await page.addInitScript(() => {
    const w = window as unknown as { hold?: boolean };
    const later = window.setTimeout;
    window.setTimeout = ((fn: TimerHandler, ms?: number, ...rest: unknown[]) => {
      if (ms !== 120) return later(fn, ms, ...rest);
      const answer = () => (w.hold ? later(answer, 50) : (fn as (...a: unknown[]) => void)(...rest));
      return later(answer, ms);
    }) as typeof window.setTimeout;
  });
  const hold = (on: boolean) => page.evaluate((v) => ((window as unknown as { hold?: boolean }).hold = v), on);
  await open(page);
  const count = page.locator(".kn-count");
  await expect(scene(page).locator("canvas")).toBeVisible();
  const all = await count.textContent();
  // Without concepts in the overview, a section's concepts come only once it is chosen, and
  // ask the camera to come to it again.
  await filters(page).click();
  await page.getByRole("button", { name: /^Concept/ }).click();
  await expect(count).not.toHaveText(all!);
  const without = await count.textContent();
  await filters(page).click();
  await scene(page).scrollIntoViewIfNeeded();
  const box = (await scene(page).boundingBox())!;
  await hold(true);
  await find(page, "common causes of low");
  await expect(page).toHaveURL(/node=sec_6479a9d1fdaf_002/);
  // The camera comes to it; the reader then drags the view, before the concepts arrive.
  const there = await resting(page);
  await drag(page, { x: box.x + box.width * 0.25, y: box.y + box.height * 0.5 }, 160, 90);
  const put = await resting(page);
  expect(Math.hypot(put.x - there.x - 160, put.y - there.y - 90)).toBeLessThan(15);
  await expect(count).toHaveText(without!);
  // They arrive: the view stays where it was put (watched for a second).
  await hold(false);
  await expect(count).not.toHaveText(without!);
  await page.waitForTimeout(1000);
  const later = await resting(page);
  expect(Math.hypot(later.x - put.x, later.y - put.y)).toBeLessThan(2);
  await expect(page).toHaveURL(/node=sec_6479a9d1fdaf_002/);
});

test("find takes the 3D view to a node, and the view can be fitted and reset", async ({ page }) => {
  await open(page);
  await expect(scene(page).locator("canvas")).toBeVisible();
  await find(page, "condenser tube fou");
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
  await open(page);
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
  await open(page, "?node=ent_fault_condenser_fouling");
  await expect(scene(page)).toHaveAttribute("data-selected", "ent_fault_condenser_fouling");
  await page.getByRole("radio", { name: "2D" }).click();
  await expect(page).toHaveURL(/gv=2d/);
  await expect(page).toHaveURL(/node=ent_fault_condenser_fouling/);
  const flat = page.getByRole("group", { name: /Knowledge graph, \d+ nodes/ });
  await expect(flat.locator('[data-node-id="ent_fault_condenser_fouling"]')).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("radio", { name: "3D" }).click();
  await expect(page).not.toHaveURL(/gv=/);
  await expect(scene(page)).toHaveAttribute("data-selected", "ent_fault_condenser_fouling");
  // From the keyboard too: the switch keeps the focus as the canvas changes under it (each
  // key once the view it asked for is shown).
  await page.getByRole("radio", { name: "3D" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "2D" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: "2D" })).toBeFocused();
  await expect(page).toHaveURL(/gv=2d/);
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("radio", { name: "3D" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: "3D" })).toBeFocused();
  await expect(page).not.toHaveURL(/gv=/);
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
  await open(page);
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
  await open(page);
  await expect(page.getByText("This browser cannot draw in 3D (WebGL is unavailable), so the graph is shown in 2D.")).toBeVisible();
  await expect(page.getByRole("radio", { name: "3D" })).toBeDisabled();
  await expect(page.getByRole("group", { name: /Knowledge graph, \d+ nodes/ }).locator(".kn-node")).toHaveCount(128);
});

test("high-contrast mode opens the graph in 2D, and 3D stays a choice", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await open(page);
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
  await expect(page.getByRole("alert").filter({ hasText: "The knowledge graph could not be loaded." })).toBeVisible();
  await page.getByRole("button", { name: "Library" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "The library could not be loaded." })).toBeVisible();
  await open(page, "?fail=knowledge:empty");
  await expect(page.getByText("The graph is empty: no document has been indexed yet.")).toBeVisible();
  await open(page, "?kv=library&fail=knowledge:empty");
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
  await open(page, "?node=ent_fault_condenser_fouling");
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
  for (const q of ["", "?kv=library", "?kv=search&q=fouling", "?node=ent_fault_condenser_fouling", "?kn=memory", "?kn=memory&mem=mem_demo004"]) {
    await open(page, q);
    await settled(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), q).toBe(0);
  }
});

test("on a phone the search, the library and the inspector stay within reach", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(scene(page).locator("canvas")).toBeVisible();
  // The buttons keep their names for assistive technology while showing only their icons.
  await expect(page.getByRole("button", { name: "Library" })).toBeInViewport();
  await expect(filters(page)).toBeInViewport();
  await expect(page.getByRole("button", { name: "Help" })).toBeInViewport();
  await find(page, "condenser tube fou");
  await expect(panel(page).getByRole("heading", { name: "Condenser tube fouling" })).toBeInViewport();
  await expect(searchBox(page)).toBeInViewport();
  await page.getByRole("button", { name: "Library" }).click();
  await expect(page.getByRole("heading", { name: "Document library" })).toBeInViewport();
  await expect(scene(page)).toBeInViewport();
});

test("no serious accessibility violations across the workspace", async ({ page }) => {
  test.slow();
  for (const q of [
    "",
    "?kv=library",
    "?kv=library&doc=doc_332e294219eb",
    "?kv=search&q=" + encodeURIComponent("What are the common causes of low chiller COP?"),
    "?node=ent_fault_condenser_fouling",
    "?gv=2d&node=ent_fault_condenser_fouling",
    "?kn=memory&mem=mem_demo004",
    "?kn=memory&mv=graph",
  ]) {
    await open(page, q);
    await expect(page.locator(".kn-loading")).toHaveCount(0);
    expect(await serious(page), q).toEqual([]);
  }
  // The controls over the graph, open: the search's choices, the filters, help.
  await open(page);
  await expect(page.locator(".kn-loading")).toHaveCount(0);
  await searchBox(page).fill("chill");
  expect(await serious(page), "search choices").toEqual([]);
  await page.keyboard.press("Escape");
  await filters(page).click();
  expect(await serious(page), "filters").toEqual([]);
  await filters(page).click();
  await page.getByRole("button", { name: "Help" }).click();
  expect(await serious(page), "help").toEqual([]);
});
