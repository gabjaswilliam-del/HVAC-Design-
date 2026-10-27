/**
 * M7: the Knowledge workspace in demo mode. The RAG Graph over the fixed demo library
 * (synthetic documents indexed by the real rule-based pipeline when the snapshot was made)
 * and Graph Memory over the fixed demo records: tabs, the graph filling the page with its
 * controls over it (M7.3), the library and the passage search beside it, documents, the
 * source reader, search with its evidence, the knowledge graph in 3D (WebGL, drawn by
 * SwiftShader in headless Chromium) and 2D, Graph Memory's timeline filling the page (M7.4)
 * and its list, failures, keyboard, reduced motion and accessibility. The local services are
 * covered by knowledge-local.spec.
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
const tab = (page: Page, name: "RAG Graph" | "Memory graph") => page.getByRole("tab", { name, exact: true });
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
/** Graph Memory's timeline, a record on it, and its one search box. */
const timeline = (page: Page) => page.getByRole("group", { name: /^Memory timeline, / });
const record = (page: Page, id: string) => page.locator(`.mm-node[data-mem-id="${id}"]`);
const memorySearch = (page: Page) => page.getByRole("combobox", { name: "Search memory" });
/** The timeline's zoom (its time scale). */
const zoom = async (page: Page) => Number(await page.locator(".mm-canvas").getAttribute("data-k"));
/** Whether a record is drawn within the timeline's frame, not merely in the page. */
const inFrame = (page: Page, id: string) =>
  page.evaluate((id) => {
    const n = document.querySelector(`.mm-node[data-mem-id="${id}"]`)?.getBoundingClientRect();
    const f = document.querySelector(".mm-canvas")!.getBoundingClientRect();
    if (!n) return false;
    const [x, y] = [n.left + n.width / 2, n.top + n.height / 2];
    return x > f.left && x < f.right && y > f.top && y < f.bottom;
  }, id);
/** A point on a stored link's line that nothing covers, to click. */
const onLink = (page: Page, id: string) =>
  page.evaluate((id) => {
    const path = document.querySelector<SVGPathElement>(`.mm-link__hit[data-link-id="${id}"]`)!;
    const m = path.getScreenCTM()!;
    for (const f of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
      const p = path.getPointAtLength(path.getTotalLength() * f);
      const [x, y] = [m.a * p.x + m.c * p.y + m.e, m.b * p.x + m.d * p.y + m.f];
      if (document.elementFromPoint(x, y) === path) return { x, y };
    }
    return null;
  }, id);
/** Graph Memory's constellation in 3D, and the name drawn with a record's sphere. */
const constellation = (page: Page) => page.getByRole("application", { name: /^Memory constellation in 3D, / });
const mark = (page: Page, id: string) => page.locator(`.mm3-label[data-mem-id="${id}"]`);
/** Where a record's sphere is drawn, in the page, as the view itself projects it (its name
 *  carries the centre and radius); null when it is behind the camera. */
const sphere = (page: Page, id: string) =>
  page.evaluate((id) => {
    const el = document.querySelector<HTMLElement>(`.mm3-label[data-mem-id="${id}"]`);
    const box = document.querySelector(".mm3")!.getBoundingClientRect();
    return el?.dataset.sx ? { x: box.left + Number(el.dataset.sx), y: box.top + Number(el.dataset.sy), r: Number(el.dataset.sr) } : null;
  }, id);
/** How far a record's sphere is from the middle of the view, as a share of the view's size. */
const offCentre = async (page: Page, id: string) => {
  const [box, s] = [(await constellation(page).boundingBox())!, await sphere(page, id)];
  return s ? Math.max(Math.abs(s.x - box.x - box.width / 2) / box.width, Math.abs(s.y - box.y - box.height / 2) / box.height) : Infinity;
};
/** The 3D camera: where it is and where it looks ("x,y,z>x,y,z", rounded). */
const lens = (page: Page) => constellation(page).getAttribute("data-camera");
/** How far apart two cameras are, both ends counted. */
const moved = (a: string | null, b: string | null) => {
  const [p, q] = [a, b].map((s) => (s ?? "").split(/[,>]/).map(Number));
  return p.length === 6 && q.length === 6 ? Math.hypot(...p.map((v, i) => v - q[i])) : Infinity;
};
/** Clicks a record's sphere where it is drawn, once the view has found it under the pointer (a
 *  click takes what the view last found there; a person's pointer is over a sphere before the
 *  press, not in the same instant). */
async function clickSphere(page: Page, id: string) {
  const s = (await sphere(page, id))!;
  await page.mouse.move(s.x, s.y);
  await expect(constellation(page)).toHaveAttribute("data-hover", id);
  await page.mouse.down();
  await page.mouse.up();
}

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
  await expect(tab(page, "Memory graph")).toHaveAttribute("aria-selected", "false");
  // The tab says "Memory graph" (sentence case), and the old name is gone from the page.
  await expect(tab(page, "Memory graph")).toHaveText("Memory graph");
  await expect(page.getByText(/Graph Memory/)).toHaveCount(0);
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
  await expect(tab(page, "Memory graph")).toBeFocused();
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

test("Graph Memory fills the display with its timeline, nothing to scroll and no names over one another", async ({ page }) => {
  test.slow();
  for (const [size, least] of [
    [{ width: 1440, height: 900 }, 0.8],
    [{ width: 390, height: 844 }, 0.65],
  ] as const) {
    await page.setViewportSize(size);
    for (const q of ["?kn=memory&mv=timeline", "?kn=memory&mv=timeline&mem=mem_demo004", "?kn=memory&mv=timeline&mlink=lnk_demo008", "?kn=memory&mv=list"]) {
      await open(page, q);
      await expect(page.locator(".mm-canvas, .mm-list .kn-entry").first()).toBeVisible();
      await settled(page);
      const m = await page.evaluate(() => {
        const main = document.querySelector(".main")!.getBoundingClientRect();
        const view = document.querySelector(".kn-memview")!.getBoundingClientRect();
        const boxes = (s: string) => [...document.querySelectorAll(s)].map((e) => e.getBoundingClientRect()).filter((r) => r.width);
        const hits = (a: DOMRect, b: DOMRect) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
        const tools = boxes(".kn-canvas__tools");
        const names = boxes(".mm-label[data-show], .mm-lane__name");
        const v = document.querySelector(".main__view")!;
        return {
          share: (view.width * view.height) / (main.width * main.height),
          inView: view.top >= main.top && view.bottom <= Math.min(innerHeight, main.bottom) + 1,
          scroll: [v.scrollHeight - v.clientHeight, document.documentElement.scrollHeight - innerHeight, document.documentElement.scrollWidth - innerWidth],
          overlap: boxes(".kn-hud > *").some((a) => tools.some((b) => hits(a, b))),
          names: names.some((a, i) => names.slice(i + 1).some((b) => hits(a, b))),
        };
      });
      const at = `${size.width}px ${q}`;
      expect(m.inView, at).toBe(true);
      expect(m.scroll, at).toEqual([0, 0, 0]);
      expect(m.overlap, at).toBe(false);
      expect(m.names, at).toBe(false);
      // Alone, the timeline takes nearly the whole display.
      if (q === "?kn=memory&mv=timeline") expect(m.share, at).toBeGreaterThan(least);
    }
  }
});

test("Graph Memory's timeline: records by their times on their equipment's lanes, simulations marked, links as arcs", async ({ page }) => {
  await open(page, "?kn=memory&mv=timeline");
  await expect(page.getByRole("status").filter({ hasText: "12 current records · 1 superseded version · 9 links" })).toBeVisible();
  // The demo records are fixed: nothing to record, and Help says why.
  await expect(page.getByRole("button", { name: "Record memory" })).toHaveCount(0);
  const tl = timeline(page);
  await expect(tl).toHaveAccessibleName("Memory timeline, 12 records and 9 links");
  await expect(tl.locator(".mm-node")).toHaveCount(12);
  // One lane for each equipment item, with its count; simulation runs above them.
  const lanes = page.locator(".mm-lane__name[data-lane-key]");
  expect(await lanes.evaluateAll((els) => els.map((e) => e.getAttribute("data-lane-key")))).toEqual(["chiller_plant_2", "cooling_towers_4", "cooling_water_pump_4"]);
  await expect(lanes.locator(".mm-lane__count")).toHaveText(["7 records", "3 records", "2 records"]);
  await expect(page.locator(".mm-lane__name--static")).toHaveText("Simulation runs");
  // Placed by their times, left to right, each on its own equipment's lane.
  const inTime = ["mem_demo001", "mem_demo003", "mem_demo004", "mem_demo007", "mem_demo009", "mem_demo015", "mem_demo016", "mem_demo018", "mem_demo011", "mem_demo013", "mem_demo020", "mem_demo021"];
  const xs: number[] = [];
  for (const id of inTime) xs.push((await record(page, id).boundingBox())!.x);
  expect(xs).toEqual([...xs].sort((a, b) => a - b));
  await expect(record(page, "mem_demo015")).toHaveAttribute("data-lane", "cooling_towers_4");
  await expect(record(page, "mem_demo021")).toHaveAttribute("data-lane", "cooling_water_pump_4");
  expect((await record(page, "mem_demo015").boundingBox())!.y).toBeGreaterThan((await record(page, "mem_demo004").boundingBox())!.y);
  // A simulation record says so, with its run's band above the lanes.
  await expect(record(page, "mem_demo009")).toHaveAccessibleName("Outcome: Simulated cleaning: Chiller 2 approach back to 2.9 K, 2026-09-30 14:00 UTC, Simulation");
  await expect(record(page, "mem_demo009")).toHaveClass(/mm-node--sim/);
  await expect(tl.locator("[data-run-id]")).toHaveCount(2);
  // The stored links only: nothing is inferred from the order in time.
  await expect(tl.locator(".mm-link")).toHaveCount(9);
  await expect(tl.locator('.mm-link[data-link-type="OCCURRED_BEFORE"]')).toHaveCount(0);
  // A run's band shows its records.
  await tl.locator('[data-run-id="run:RUN-0002"]').click();
  await expect(panel(page).getByRole("heading", { name: "RUN-0002" })).toBeVisible();
  await expect(panel(page)).toContainText("simulated results, not plant telemetry");
  await expect(record(page, "mem_demo009")).toHaveAttribute("data-state", "linked");
  await expect(record(page, "mem_demo004")).toHaveAttribute("data-state", "dim");
  // Help: how to read it, what Graph Memory keeps, and that the demo records are fixed.
  await page.getByRole("button", { name: "Help" }).click();
  const help = page.getByRole("region", { name: "Reading the memory graph" });
  await expect(help).toContainText("Arcs are the links people stored between records");
  await expect(help).toContainText(/The demo records are fixed/);
});

test("Graph Memory: choosing a record lights its stored links, follows its chain and keeps its history", async ({ page }) => {
  await open(page, "?kn=memory&mv=timeline");
  const tl = timeline(page);
  await settled(page);
  // The record clicked stays where it was while the panel opens beside the timeline.
  const left = async (id: string) => (await record(page, id).boundingBox())!.x;
  const at = await left("mem_demo004");
  await record(page, "mem_demo004").click();
  await expect(page).toHaveURL(/mem=mem_demo004/);
  await expect(panel(page).getByRole("heading", { name: "Condenser tube fouling likely on Chiller 2" })).toBeVisible();
  await expect(record(page, "mem_demo004")).toHaveAttribute("aria-pressed", "true");
  await expect(panel(page)).toContainText("Resolved by");
  await expect(panel(page)).toContainText("Supported by");
  await settled(page);
  expect(Math.abs((await left("mem_demo004")) - at)).toBeLessThan(1);
  // Its stored links light up with the records they join; the chain they lead on to stays
  // readable; the rest fade (all of them in view after Fit).
  await expect(tl.locator(".mm-link--lit")).toHaveCount(4);
  await page.getByRole("button", { name: "Fit" }).click();
  await settled(page);
  await expect(tl.locator(".mm-node")).toHaveCount(12);
  for (const id of ["mem_demo001", "mem_demo003", "mem_demo007", "mem_demo011"]) await expect(record(page, id)).toHaveAttribute("data-state", "linked");
  for (const id of ["mem_demo009", "mem_demo013"]) await expect(record(page, id)).toHaveAttribute("data-state", "chain");
  for (const id of ["mem_demo015", "mem_demo016", "mem_demo018", "mem_demo020", "mem_demo021"]) await expect(record(page, id)).toHaveAttribute("data-state", "dim");
  // The chain, in time, to follow.
  await expect(panel(page)).toContainText("Linked chain: 7 records");
  const chain = panel(page).locator(".mm-chain li");
  await expect(chain).toHaveCount(7);
  await expect(chain.first()).toContainText("Chiller 2 tripped on high head pressure");
  await chain.getByRole("button", { name: /^Simulated cleaning/ }).click();
  await expect(panel(page).getByRole("heading", { name: "Simulated cleaning: Chiller 2 approach back to 2.9 K" })).toBeVisible();
  await expect(record(page, "mem_demo009")).toHaveAttribute("aria-pressed", "true");
  // Closing the panel keeps the place: nothing moves, at the same zoom.
  await settled(page);
  const [k, before] = [await zoom(page), await left("mem_demo009")];
  await panel(page).getByRole("button", { name: "Close panel" }).click();
  await expect(panel(page)).toHaveCount(0);
  await settled(page);
  expect(Math.abs((await left("mem_demo009")) - before)).toBeLessThan(1);
  expect(await zoom(page)).toBe(k);
  // A click on empty space clears the choice.
  await record(page, "mem_demo004").click();
  await expect(record(page, "mem_demo015")).toHaveAttribute("data-state", "dim");
  const frame = (await page.locator(".mm-canvas").boundingBox())!;
  await page.locator(".mm-canvas").click({ position: { x: 30, y: frame.height - 30 } });
  await expect(page).not.toHaveURL(/mem=/);
  await expect(record(page, "mem_demo015")).toHaveAttribute("data-state", "normal");

  // Superseded versions on request: under the version that replaced them, with the history.
  await filters(page).click();
  await page.getByRole("checkbox", { name: "Include superseded versions" }).check();
  await expect(filters(page)).toHaveAccessibleName("Filters (1 on)");
  await filters(page).click();
  const old = record(page, "mem_demo002");
  await expect(old).toHaveAttribute("data-status", "superseded");
  await expect(old).toHaveAccessibleName(/, superseded$/);
  await expect(tl.locator(".mm-node")).toHaveCount(13);
  await settled(page);
  const [current, replaced] = [(await record(page, "mem_demo003").boundingBox())!, (await old.boundingBox())!];
  expect(Math.abs(current.x - replaced.x)).toBeLessThan(1);
  expect(replaced.y).toBeGreaterThan(current.y);
  await expect(tl.locator('.mm-link[data-link-type="SUPERSEDES"]')).toHaveCount(1);
  await old.click();
  await expect(panel(page)).toContainText("Until 2026-09-29 10:15 UTC, then corrected.");
  await expect(panel(page).locator(".kn-history li")).toHaveCount(2);
  await panel(page).getByRole("button", { name: "Open the current version" }).click();
  await expect(panel(page).getByRole("heading", { name: "Chiller 2 condenser approach 4.2 K at 70% load" })).toBeVisible();
  await expect(panel(page)).toContainText("Reason: The leaving condenser water sensor read 0.6 K low");
  await expect(panel(page)).toContainText("Supports");
});

test("Graph Memory: a stored link opens on its own, with what it joins and when it was made", async ({ page }) => {
  await open(page, "?kn=memory&mv=timeline");
  await expect(timeline(page)).toBeVisible();
  await settled(page);
  const point = await onLink(page, "lnk_demo012");
  expect(point, "a clear point on the link").not.toBeNull();
  await page.mouse.click(point!.x, point!.y);
  await expect(page).toHaveURL(/mlink=lnk_demo012/);
  await expect(panel(page).getByRole("heading", { name: "Resolved by" })).toBeVisible();
  await expect(panel(page)).toContainText("Condenser tube fouling likely on Chiller 2");
  await expect(panel(page)).toContainText("was resolved by");
  await expect(panel(page)).toContainText("Chiller 2 condenser tubes cleaned and returned to service");
  await expect(panel(page)).toContainText("A stored link, made 2026-10-02 15:20 UTC.");
  await expect(panel(page)).toContainText("none is inferred");
  // The link and the two records it joins light up.
  await expect(timeline(page).locator(".mm-link--lit")).toHaveCount(1);
  await expect(record(page, "mem_demo004")).toHaveAttribute("data-state", "linked");
  await expect(record(page, "mem_demo011")).toHaveAttribute("data-state", "linked");
  await expect(record(page, "mem_demo001")).toHaveAttribute("data-state", "dim");
  // On to a record it joins.
  await panel(page).getByRole("button", { name: /^Chiller 2 condenser tubes cleaned and returned to service/ }).click();
  await expect(panel(page).getByRole("heading", { name: "Chiller 2 condenser tubes cleaned and returned to service" })).toBeVisible();
  await expect(page).toHaveURL(/mem=mem_demo011/);
  await expect(page).not.toHaveURL(/mlink=/);
});

test("Graph Memory's one search box: records by any of their words, equipment, kinds, days and ranges", async ({ page }) => {
  await open(page, "?kn=memory&mv=timeline");
  await expect(timeline(page)).toBeVisible();
  const box = memorySearch(page);
  // An equipment item: its records framed, while its panel opens beside them.
  await box.fill("chiller 2");
  await choices(page).filter({ hasText: "Equipment: Chiller 2" }).click();
  await expect(panel(page).getByRole("heading", { name: "Chiller 2" })).toBeVisible();
  await settled(page);
  for (const id of ["mem_demo001", "mem_demo003", "mem_demo004", "mem_demo007", "mem_demo009", "mem_demo011", "mem_demo013"]) expect(await inFrame(page, id), id).toBe(true);
  await panel(page).getByRole("button", { name: "Close panel" }).click();
  // A record by its title: Enter takes the first match and opens it on the timeline.
  await box.fill("fouling");
  await expect(choices(page).first()).toContainText("Condenser tube fouling likely on Chiller 2");
  await expect(choices(page).first()).toContainText("Finding · 2026-09-29 10:30 UTC · Chiller 2");
  await expect(choices(page).last()).toContainText("Search all records for “fouling”");
  await box.press("Enter");
  await expect(page).toHaveURL(/mem=mem_demo004/);
  await expect(record(page, "mem_demo004")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => inFrame(page, "mem_demo004")).toBe(true);
  // Not only the titles shown: the notes, and versions the filters leave out.
  await box.fill("purge log");
  await expect(choices(page).first()).toContainText("Condenser tube fouling likely on Chiller 2");
  await box.fill("4.8 K");
  await expect(choices(page).filter({ hasText: "Chiller 2 condenser approach 4.8 K at 70% load" })).toContainText("Superseded");
  // An equipment item: its lane and its records, brought into view; the others fade.
  await box.fill("tower");
  await choices(page).filter({ hasText: "Equipment: Cooling tower 4" }).click();
  await expect(page.locator('.mm-lane__name[data-lane-key="cooling_towers_4"]')).toHaveAttribute("aria-pressed", "true");
  await expect(panel(page).getByRole("heading", { name: "Cooling tower 4" })).toBeVisible();
  await expect(panel(page).locator(".kn-history li")).toHaveCount(3);
  await settled(page);
  for (const id of ["mem_demo015", "mem_demo016", "mem_demo018"]) {
    await expect(record(page, id)).toHaveAttribute("data-state", "linked");
    expect(await inFrame(page, id), id).toBe(true);
  }
  expect(await timeline(page).locator('.mm-node:not([data-lane="cooling_towers_4"])').evaluateAll((els) => els.length > 0 && els.every((e) => e.getAttribute("data-state") === "dim"))).toBe(true);
  // A kind: a filter, which the Filters button counts.
  await box.fill("decis");
  await choices(page).filter({ hasText: "Only decisions" }).click();
  await expect(filters(page)).toHaveAccessibleName("Filters (1 on)");
  await expect(timeline(page).locator(".mm-node")).toHaveCount(2);
  await filters(page).click();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await filters(page).click();
  await expect(timeline(page).locator(".mm-node")).toHaveCount(12);
  // A day: the timeline goes there.
  await settled(page);
  const k = await zoom(page);
  await box.fill("1 Oct");
  await choices(page).filter({ hasText: "Go to 1 Oct 2026" }).click();
  await expect.poll(() => zoom(page)).toBeGreaterThan(k * 1.5);
  await settled(page);
  for (const id of ["mem_demo015", "mem_demo016", "mem_demo018"]) expect(await inFrame(page, id), id).toBe(true);
  expect(await inFrame(page, "mem_demo001")).toBe(false);
  // A range of days: only those.
  await box.fill("28 Sep to 29 Sep");
  await choices(page).filter({ hasText: "Only 28 Sep 2026 to 29 Sep 2026" }).click();
  await expect(timeline(page).locator(".mm-node")).toHaveCount(4);
  await expect(filters(page)).toHaveAccessibleName("Filters (1 on)");
  await filters(page).click();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await filters(page).click();
  // Words: the records that mention them, said over the timeline.
  await box.fill("approach");
  await choices(page).last().click();
  await expect(page.getByText("Records that mention “approach”.")).toBeVisible();
  await expect(record(page, "mem_demo013")).toBeVisible();
  await expect(record(page, "mem_demo015")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(timeline(page).locator(".mm-node")).toHaveCount(12);
});

test("Graph Memory by keyboard: through time and across lanes, inspect, zoom and fit", async ({ page }) => {
  await open(page, "?kn=memory&mv=timeline");
  const tl = timeline(page);
  // One tab stop: the latest record.
  const stop = tl.locator('.mm-node[tabindex="0"]');
  await expect(stop).toHaveCount(1);
  await expect(stop).toHaveAttribute("data-mem-id", "mem_demo021");
  await stop.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(record(page, "mem_demo020")).toBeFocused();
  await expect(page.locator(".mm-frame [aria-live]")).toHaveText("Event: CW pump 4 standby rotation run, 2026-10-04 09:00 UTC, Demo. Enter inspects it.");
  await page.keyboard.press("Home");
  await expect(record(page, "mem_demo001")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(record(page, "mem_demo003")).toBeFocused();
  // Down to the next equipment's lane, at the record nearest in time.
  await page.keyboard.press("ArrowDown");
  await expect(record(page, "mem_demo015")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/mem=mem_demo015/);
  await expect(panel(page).getByRole("heading", { name: "Cooling tower 4 fan vibration rising" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/mem=/);
  await expect(record(page, "mem_demo015")).toBeFocused();
  // + zooms in at the record, 0 fits it all again.
  await page.keyboard.press("0");
  await settled(page);
  const k = await zoom(page);
  await page.keyboard.press("+");
  await expect.poll(() => zoom(page)).toBeGreaterThan(k * 1.3);
  await page.keyboard.press("0");
  await expect.poll(() => zoom(page)).toBeCloseTo(k, 2);
  await settled(page);
  // Two quick presses of Zoom in add up, the second from where the first is going.
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await settled(page);
  expect(await zoom(page)).toBeCloseTo(k * 1.4 * 1.4, 2);
  // Tabbed to while out of sight (the view moved since), the tab stop comes into view.
  const frame = (await page.locator(".mm-canvas").boundingBox())!;
  await page.mouse.move(frame.x + 30, frame.y + frame.height / 2);
  await page.mouse.wheel(0, -600);
  await page.mouse.wheel(0, -600);
  await expect.poll(async () => inFrame(page, "mem_demo015")).toBe(false);
  await filters(page).focus();
  await page.keyboard.press("Tab");
  await expect(record(page, "mem_demo015")).toBeFocused();
  await expect.poll(() => inFrame(page, "mem_demo015")).toBe(true);
  // The browser's own keys stay the browser's: Ctrl with = (its zoom) is not taken.
  await settled(page);
  const before = await zoom(page);
  await page.evaluate(() => addEventListener("keydown", (e) => ((window as unknown as { taken: boolean }).taken = e.defaultPrevented)));
  await page.keyboard.press("Control+Equal");
  expect(await page.evaluate(() => (window as unknown as { taken: boolean }).taken)).toBe(false);
  expect(await zoom(page)).toBe(before);
});

test("Graph Memory: a record's address shows the whole timeline, that record chosen in it", async ({ page }) => {
  for (const id of ["mem_demo001", "mem_demo021"]) {
    await open(page, `?kn=memory&mv=timeline&mem=${id}`);
    await expect(record(page, id)).toHaveAttribute("aria-pressed", "true");
    await settled(page);
    expect(await inFrame(page, id), id).toBe(true);
    // Every record is drawn or counted on a record beside it ("+n"), at the zoom Fit gives.
    const accounted = await timeline(page).evaluate(
      (el) => el.querySelectorAll(".mm-node").length + [...el.querySelectorAll(".mm-node__more text")].reduce((n, t) => n + Number(t.textContent!.slice(1)), 0),
    );
    expect(accounted, id).toBe(12);
    const k = await zoom(page);
    await page.getByRole("button", { name: "Fit" }).click();
    await settled(page);
    expect(await zoom(page), id).toBeCloseTo(k, 3);
  }
});

test.describe("Graph Memory on a touch screen", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test("a pinch zooms time, and the finger left down pans on from where it left the view", async ({ page }) => {
    await open(page, "?kn=memory&mv=timeline");
    await expect(timeline(page)).toBeVisible();
    await settled(page);
    const box = (await page.locator(".mm-canvas").boundingBox())!;
    const [cx, cy] = [box.x + box.width / 2, box.y + box.height * 0.55];
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", points: { x: number; y: number; id: number }[]) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
    const k = await zoom(page);
    // The fingers spread from 60 px apart to 220: time zooms by as much.
    const pinched = (k * 220) / 60;
    await touch("touchStart", [{ x: cx - 30, y: cy, id: 0 }, { x: cx + 30, y: cy, id: 1 }]);
    for (let i = 1; i <= 10; i++) await touch("touchMove", [{ x: cx - 30 - i * 8, y: cy, id: 0 }, { x: cx + 30 + i * 8, y: cy, id: 1 }]);
    await expect.poll(() => zoom(page)).toBeCloseTo(pinched, 2);
    // One finger lifts; the other moves on, panning: the zoom stays the pinch's.
    await touch("touchEnd", [{ x: cx - 110, y: cy, id: 0 }]);
    for (let i = 1; i <= 5; i++) await touch("touchMove", [{ x: cx + 110 + i * 6, y: cy, id: 1 }]);
    await touch("touchEnd", []);
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    expect(await zoom(page)).toBeCloseTo(pinched, 2);
  });
});

// ---- Graph Memory's constellation in 3D (M7.5) ---------------------------------------------------
// It opens by default. A record's sphere is found where the view itself projects it (its name
// carries the centre and radius); the camera is read from the view (`data-camera`). What an
// action does is waited for (a flight starts once the address has changed), not assumed.

/** The 3D camera once it has come to rest: flights done, a drag's glide over. */
async function still(page: Page) {
  await settled(page);
  let last = await lens(page);
  for (;;) {
    await page.waitForTimeout(200);
    const now = await lens(page);
    if (now === last) return now;
    last = now;
  }
}
/** The constellation drawn: every record's sphere placed on screen (a first drawing waits for
 *  the software WebGL to start, slower while other workers start theirs). */
const drawn = (page: Page, records = 12) => expect(page.locator(".mm3-label[data-sx]")).toHaveCount(records, { timeout: 15_000 });
/** Whether these records' spheres are all within the view. */
const inView3d = (page: Page, ids: string[]) =>
  page.evaluate((ids) => {
    const box = document.querySelector(".mm3")!.getBoundingClientRect();
    return ids.every((id) => {
      const el = document.querySelector<HTMLElement>(`.mm3-label[data-mem-id="${id}"]`);
      const [x, y] = [Number(el?.dataset.sx), Number(el?.dataset.sy)];
      return el?.dataset.sx !== undefined && x > 0 && y > 0 && x < box.width && y < box.height;
    });
  }, ids);
/** Waits for the camera to come to `at` (to the rounding of `data-camera`) and stay there. */
async function backTo(page: Page, at: string | null, what = "back where it was") {
  await expect.poll(async () => moved(await lens(page), at), { message: what, timeout: 10_000 }).toBeLessThan(3);
  expect(moved(await still(page), at), what).toBeLessThan(3);
}
/** Waits for the camera to leave `from`, then to stop; where it went. */
async function flown(page: Page, from: string | null) {
  await expect.poll(async () => moved(await lens(page), from), { message: "the camera moves", timeout: 10_000 }).toBeGreaterThan(20);
  return still(page);
}
/** Waits for a record's sphere to be flown to the middle of the view, and the camera to stop. */
async function centred(page: Page, id: string) {
  await expect.poll(() => offCentre(page, id), { message: `${id} in the middle`, timeout: 10_000 }).toBeLessThan(0.12);
  await still(page);
  expect(await offCentre(page, id), `${id} in the middle`).toBeLessThan(0.12);
}
/** A point on the canvas as far as can be from every sphere (where a click finds nothing). */
const emptySpace = (page: Page) =>
  page.evaluate(() => {
    const box = document.querySelector(".mm3")!.getBoundingClientRect();
    const spheres = [...document.querySelectorAll<HTMLElement>(".mm3-label[data-sx]")].map((e) => ({ x: box.left + Number(e.dataset.sx), y: box.top + Number(e.dataset.sy) }));
    let best = { x: 0, y: 0, d: -1 };
    for (let x = box.left + 20; x < box.right - 20; x += 30)
      for (let y = box.top + 20; y < box.bottom - 20; y += 30) {
        if (document.elementFromPoint(x, y)?.tagName !== "CANVAS") continue;
        const d = Math.min(...spheres.map((s) => Math.hypot(s.x - x, s.y - y)));
        if (d > best.d) best = { x, y, d };
      }
    return best;
  });

test("Graph Memory opens as a constellation in 3D that fills the display: no grid, nothing to scroll, no names over one another", async ({ page }) => {
  test.slow();
  for (const [size, least, span] of [
    [{ width: 1440, height: 900 }, 0.8, [0.6, 0.5]],
    [{ width: 390, height: 844 }, 0.65, [0.45, 0.45]],
  ] as const) {
    await page.setViewportSize(size);
    for (const q of ["?kn=memory", "?kn=memory&mem=mem_demo004", "?kn=memory&mlink=lnk_demo008"]) {
      await open(page, q);
      await drawn(page);
      await still(page);
      const m = await page.evaluate(() => {
        const main = document.querySelector(".main")!.getBoundingClientRect();
        const view = document.querySelector(".kn-memview")!.getBoundingClientRect();
        const stage = document.querySelector(".mm3")!.getBoundingClientRect();
        const boxes = (s: string) => [...document.querySelectorAll(s)].map((e) => e.getBoundingClientRect()).filter((r) => r.width);
        const hits = (a: DOMRect, b: DOMRect) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
        const tools = boxes(".kn-canvas__tools");
        const names = boxes(".mm3 .kn-3d__label[data-show]");
        const spheres = [...document.querySelectorAll<HTMLElement>(".mm3-label[data-sx]")].map((e) => ({ x: Number(e.dataset.sx), y: Number(e.dataset.sy), r: Number(e.dataset.sr) }));
        const xs = spheres.flatMap((s) => [s.x - s.r, s.x + s.r]);
        const ys = spheres.flatMap((s) => [s.y - s.r, s.y + s.r]);
        const v = document.querySelector(".main__view")!;
        return {
          share: (view.width * view.height) / (main.width * main.height),
          inView: view.top >= main.top && view.bottom <= Math.min(innerHeight, main.bottom) + 1,
          scroll: [v.scrollHeight - v.clientHeight, document.documentElement.scrollHeight - innerHeight, document.documentElement.scrollWidth - innerWidth],
          overlap: boxes(".kn-hud > *").some((a) => tools.some((b) => hits(a, b))),
          names: names.some((a, i) => names.slice(i + 1).some((b) => hits(a, b))),
          // How much of the view the spheres span, how far their middle is from its middle, and
          // whether every one is in it.
          span: [(Math.max(...xs) - Math.min(...xs)) / stage.width, (Math.max(...ys) - Math.min(...ys)) / stage.height],
          off: [((Math.max(...xs) + Math.min(...xs)) / 2 - stage.width / 2) / stage.width, ((Math.max(...ys) + Math.min(...ys)) / 2 - stage.height / 2) / stage.height],
          inside: spheres.every((s) => s.x - s.r > 0 && s.y - s.r > 0 && s.x + s.r < stage.width && s.y + s.r < stage.height),
        };
      });
      const at = `${size.width}px ${q}`;
      expect(m.inView, at).toBe(true);
      expect(m.scroll, at).toEqual([0, 0, 0]);
      expect(m.overlap, at).toBe(false);
      expect(m.names, at).toBe(false);
      if (q !== "?kn=memory") continue;
      // The overview: the display taken, every sphere in view, spread across it, centred.
      expect(m.share, at).toBeGreaterThan(least);
      expect(m.inside, at).toBe(true);
      expect(m.span[0], at).toBeGreaterThan(span[0]);
      expect(m.span[1], at).toBeGreaterThan(span[1]);
      expect(Math.abs(m.off[0]), at).toBeLessThan(0.1);
      expect(Math.abs(m.off[1]), at).toBeLessThan(0.1);
      // No grid: no lanes' rules, no time axis, no chart.
      await expect(page.locator(".mm-canvas, .mm-lane__rule, .mm-axis"), at).toHaveCount(0);
    }
  }
});

test("Graph Memory's constellation: a sphere for each record in its equipment's group by its time, simulations ringed, its own help", async ({ page }) => {
  test.slow();
  await open(page, "?kn=memory");
  await expect(page.getByRole("status").filter({ hasText: "12 current records · 1 superseded version · 9 links" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "3D" })).toHaveAttribute("aria-checked", "true");
  const view = constellation(page);
  await expect(view).toHaveAccessibleName("Memory constellation in 3D, 12 records and 9 links");
  await expect(view).toHaveAttribute("data-mode", "overview");
  await drawn(page);
  const home = await still(page);
  // One group for each equipment item, named at its left with its count, top to bottom.
  const lanes = page.locator(".mm3-lane[data-lane-key]");
  const keys = ["chiller_plant_2", "cooling_towers_4", "cooling_water_pump_4"];
  expect(await lanes.evaluateAll((els) => els.map((e) => e.getAttribute("data-lane-key")))).toEqual(keys);
  await expect(lanes.locator(".mm3-lane__count")).toHaveText(["7 records", "3 records", "2 records"]);
  for (const key of keys) await expect(page.locator(`.mm3-lane[data-lane-key="${key}"]`)).toHaveAttribute("data-show", "");
  // Its records together, the groups top to bottom; in each, time runs left to right.
  const middles: number[] = [];
  for (const key of keys) {
    const ids = await page.locator(`.mm3-label[data-lane="${key}"]`).evaluateAll((els) => els.map((e) => e.getAttribute("data-mem-id")!));
    const at = await Promise.all(ids.map(async (id) => (await sphere(page, id))!));
    expect(at.map((p) => p.x), key).toEqual(at.map((p) => p.x).sort((a, b) => a - b));
    middles.push(at.reduce((sum, p) => sum + p.y, 0) / at.length);
    const name = (await page.locator(`.mm3-lane[data-lane-key="${key}"]`).boundingBox())!;
    expect(name.x + name.width, `${key}'s name at its left`).toBeLessThan(Math.min(...at.map((p) => p.x)));
  }
  expect(middles).toEqual([...middles].sort((a, b) => a - b));
  await expect(mark(page, "mem_demo015")).toHaveAttribute("data-lane", "cooling_towers_4");
  // The dates below everything, in order.
  const days = page.locator(".mm3-day[data-day][data-show]");
  expect(await days.count()).toBeGreaterThan(3);
  const lowest = Math.max(...(await Promise.all(["mem_demo020", "mem_demo021"].map(async (id) => (await sphere(page, id))!.y))));
  const dayBoxes = await days.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.left, r.top] as const));
  for (const [, top] of dayBoxes) expect(top).toBeGreaterThan(lowest);
  expect(dayBoxes.map(([left]) => left)).toEqual(dayBoxes.map(([left]) => left).sort((a, b) => a - b));
  // A simulation record says so (its sphere is ringed); its run is named above it.
  await expect(mark(page, "mem_demo009")).toHaveAttribute("data-provenance", "simulation");
  await expect(mark(page, "mem_demo004")).toHaveAttribute("data-provenance", "demo");
  await expect(page.locator(".mm3-run[data-run-id]")).toHaveCount(2);
  const run = page.locator('.mm3-run[data-run-id="run:RUN-0002"]');
  await expect(run).toHaveAttribute("data-show", "");
  expect((await run.boundingBox())!.y).toBeLessThan((await sphere(page, "mem_demo009"))!.y);
  // A run's name shows its records.
  await run.click();
  await expect(panel(page).getByRole("heading", { name: "RUN-0002" })).toBeVisible();
  await expect(panel(page)).toContainText("simulated results, not plant telemetry");
  await expect(view).toHaveAttribute("data-mode", "focus");
  await expect(mark(page, "mem_demo009")).toHaveAttribute("data-state", "linked");
  await expect(mark(page, "mem_demo004")).toHaveAttribute("data-state", "dim");
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/mem=/);
  await backTo(page, home);
  // A group's name shows its records, framed; again, and the choice is cleared.
  const tower = page.locator('.mm3-lane[data-lane-key="cooling_towers_4"]');
  await tower.click();
  await expect(page).toHaveURL(/mem=equipment(%3A|:)cooling_towers_4/);
  await expect(panel(page).getByRole("heading", { name: "Cooling tower 4" })).toBeVisible();
  for (const id of ["mem_demo015", "mem_demo016", "mem_demo018"]) await expect(mark(page, id)).toHaveAttribute("data-state", "linked");
  await expect(mark(page, "mem_demo009")).toHaveAttribute("data-state", "dim");
  await flown(page, home);
  await expect.poll(() => inView3d(page, ["mem_demo015", "mem_demo016", "mem_demo018"])).toBe(true);
  await expect(tower).toHaveAttribute("data-show", "");
  await tower.click();
  await expect(page).not.toHaveURL(/mem=/);
  await expect(mark(page, "mem_demo009")).toHaveAttribute("data-state", "normal");
  await backTo(page, home);
  // Help reads the constellation, with its keys; the demo records are fixed.
  await page.getByRole("button", { name: "Help" }).click();
  const help = page.getByRole("region", { name: "Reading the memory graph" });
  await expect(help).toContainText("A dashed blue ring circling a sphere marks a simulation record");
  await expect(help).toContainText("Arcs are the links people stored, with an arrow towards the linked record; nothing is inferred.");
  await expect(help).toContainText("Left and Right move through the records in time");
  await expect(help).toContainText(/The demo records are fixed/);
});

test("Graph Memory in 3D: a sphere clicked is flown to with what it is linked to; closing flies back to exactly where the camera was", async ({ page }) => {
  test.slow();
  await open(page, "?kn=memory");
  const view = constellation(page);
  await drawn(page);
  const home = await still(page);
  const far = Number(await view.getAttribute("data-distance"));
  // Under the pointer a sphere says so; a click chooses it.
  const s = (await sphere(page, "mem_demo016"))!;
  await page.mouse.move(s.x, s.y);
  await expect(view).toHaveAttribute("data-hover", "mem_demo016");
  await page.mouse.down();
  await page.mouse.up();
  await expect(page).toHaveURL(/mem=mem_demo016/);
  await expect(panel(page).getByRole("heading", { name: "Cooling tower 4 fan fault limits heat rejection in the heat-wave simulation" })).toBeVisible();
  await expect(view).toHaveAttribute("data-mode", "focus");
  // Flown to: in the middle, much nearer and larger, named with its kind and time; the records
  // its stored links join lit round it, the rest faded.
  await centred(page, "mem_demo016");
  expect(Number(await view.getAttribute("data-distance"))).toBeLessThan(far * 0.6);
  expect((await sphere(page, "mem_demo016"))!.r).toBeGreaterThan(s.r * 1.5);
  await expect(mark(page, "mem_demo016")).toHaveAttribute("data-state", "on");
  await expect(mark(page, "mem_demo016")).toHaveAttribute("data-show", "");
  await expect(mark(page, "mem_demo016").locator(".mm3-label__meta")).toHaveText("Finding · 2026-10-01 13:00 UTC");
  for (const id of ["mem_demo015", "mem_demo018"]) await expect(mark(page, id)).toHaveAttribute("data-state", "linked");
  expect(await inView3d(page, ["mem_demo015", "mem_demo018"])).toBe(true);
  for (const id of ["mem_demo004", "mem_demo020"]) await expect(mark(page, id)).toHaveAttribute("data-state", "dim");
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/mem=/);
  await backTo(page, home);
  // A record whose links span the constellation: it and every record they join in view, it
  // larger than before; the chain they lead on to readable; the rest faded.
  const hub = (await sphere(page, "mem_demo004"))!;
  await clickSphere(page, "mem_demo004");
  await expect(page).toHaveURL(/mem=mem_demo004/);
  await flown(page, home);
  const linked = ["mem_demo001", "mem_demo003", "mem_demo007", "mem_demo011"];
  for (const id of linked) await expect(mark(page, id)).toHaveAttribute("data-state", "linked");
  expect(await inView3d(page, ["mem_demo004", ...linked])).toBe(true);
  expect((await sphere(page, "mem_demo004"))!.r).toBeGreaterThan(hub.r * 1.3);
  for (const id of ["mem_demo009", "mem_demo013"]) await expect(mark(page, id)).toHaveAttribute("data-state", "chain");
  for (const id of ["mem_demo015", "mem_demo016", "mem_demo018", "mem_demo020", "mem_demo021"]) await expect(mark(page, id)).toHaveAttribute("data-state", "dim");
  // On along the chain: the camera goes on to the next record.
  await expect(panel(page)).toContainText("Linked chain: 7 records");
  await panel(page).locator(".mm-chain li").getByRole("button", { name: /^Simulated cleaning/ }).click();
  await expect(view).toHaveAttribute("data-selected", "mem_demo009");
  await centred(page, "mem_demo009");
  await expect(mark(page, "mem_demo009")).toHaveAttribute("data-state", "on");
  // Escape: back to where the camera was before the first choice, nothing emphasised.
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/mem=/);
  await expect(view).toHaveAttribute("data-mode", "overview");
  await backTo(page, home);
  await expect(mark(page, "mem_demo009")).toHaveAttribute("data-state", "normal");
  // From a view moved by hand, closing each way returns to that view, not to the overview.
  const box = (await view.boundingBox())!;
  for (const how of ["the close button", "Escape", "a click on empty space"]) {
    await drag(page, { x: box.x + box.width * 0.5, y: box.y + box.height * 0.6 }, -36, 24);
    const before = await still(page);
    expect(moved(before, home), how).toBeGreaterThan(10);
    await clickSphere(page, "mem_demo013");
    await expect(view).toHaveAttribute("data-selected", "mem_demo013");
    await expect(panel(page).getByRole("heading", { name: "Chiller 2 condenser approach 2.8 K after cleaning" })).toBeVisible();
    await flown(page, before);
    if (how === "Escape") await page.keyboard.press("Escape");
    else if (how === "the close button") await panel(page).getByRole("button", { name: "Close panel" }).click();
    else {
      const empty = await emptySpace(page);
      expect(empty.d, "room to click").toBeGreaterThan(60);
      await page.mouse.move(empty.x, empty.y);
      await expect(view).not.toHaveAttribute("data-hover");
      await expect(view.locator("canvas"), "nothing to click there, links included").not.toHaveClass(/clickable/);
      await page.mouse.down();
      await page.mouse.up();
    }
    await expect(page, how).not.toHaveURL(/mem=/);
    await backTo(page, before, how);
  }
});

test("Graph Memory in 3D: quick choices, and flights cut short, still return to where the camera was", async ({ page }) => {
  test.slow();
  // Time is the page's own (Playwright's clock), held still where a flight must be cut short at
  // a known moment: a slow machine draws few frames in a flight.
  await page.clock.install();
  await open(page, "?kn=memory");
  const view = constellation(page);
  await drawn(page);
  const home = await still(page);
  // A sphere, then a record it is linked to (by its name) 150 ms into the flight, then Escape
  // 150 ms into that one. (The pointer is over the sphere before time stops: a click takes what
  // the view last found under the pointer.)
  const s4 = (await sphere(page, "mem_demo004"))!;
  await page.mouse.move(s4.x, s4.y);
  await expect(view).toHaveAttribute("data-hover", "mem_demo004");
  await page.clock.pauseAt(Date.now() + 1000);
  await page.mouse.down();
  await page.mouse.up();
  await page.clock.runFor(50);
  await expect(view).toHaveAttribute("data-selected", "mem_demo004");
  await page.clock.runFor(150);
  expect(moved(await lens(page), home), "on its way").toBeGreaterThan(20);
  await mark(page, "mem_demo011").dispatchEvent("click");
  await expect(view).toHaveAttribute("data-selected", "mem_demo011");
  await page.clock.runFor(150);
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/mem=/);
  await page.clock.resume();
  await backTo(page, home);
  // Each flight below starts after a pause of a few seconds, when GSAP's ticker has gone to
  // sleep (its frames then come after the 3D library's in each frame, as they do for anyone
  // who clicks after a moment's look).
  // At the start of the way back (time held there), a click on a sphere: that record is chosen,
  // and closing it returns to the first place, where the camera was going.
  await clickSphere(page, "mem_demo013");
  await expect(view).toHaveAttribute("data-selected", "mem_demo013");
  await flown(page, home);
  await page.waitForTimeout(2500);
  await page.clock.pauseAt(Date.now() + 1000);
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/mem=/);
  // One frame, for the spheres' places in the view the closed panel widened.
  await page.clock.runFor(20);
  const s11 = (await sphere(page, "mem_demo011"))!;
  await page.mouse.move(s11.x, s11.y);
  await page.clock.runFor(60);
  await expect(view).toHaveAttribute("data-hover", "mem_demo011");
  await page.mouse.down();
  await page.mouse.up();
  await page.clock.runFor(100);
  await expect(view).toHaveAttribute("data-selected", "mem_demo011");
  await page.clock.resume();
  await still(page);
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/mem=/);
  await backTo(page, home);
  // A double click on empty space to close: the second click, on the way back, lets it go on.
  await clickSphere(page, "mem_demo016");
  await centred(page, "mem_demo016");
  const empty = await emptySpace(page);
  expect(empty.d, "room to click").toBeGreaterThan(60);
  await page.mouse.move(empty.x, empty.y);
  await expect(view).not.toHaveAttribute("data-hover");
  await expect(view.locator("canvas"), "nothing to click there, links included").not.toHaveClass(/clickable/);
  await page.waitForTimeout(2500);
  await page.clock.pauseAt(Date.now() + 1000);
  await page.mouse.down();
  await page.mouse.up();
  await page.clock.runFor(50);
  await expect(page).not.toHaveURL(/mem=/);
  await expect.poll(() => page.evaluate(() => Boolean(document.documentElement.dataset.motion)), { message: "on its way back" }).toBe(true);
  await page.clock.runFor(100);
  await page.mouse.down();
  await page.mouse.up();
  await page.clock.runFor(1000);
  await page.clock.resume();
  await backTo(page, home, "the way back gone on");
  // A click on empty space while Fit flies, a record chosen: Fit goes on, the record stays.
  await clickSphere(page, "mem_demo015");
  await centred(page, "mem_demo015");
  await page.waitForTimeout(2500);
  await page.clock.pauseAt(Date.now() + 1000);
  await page.getByRole("button", { name: "Fit" }).dispatchEvent("click");
  await page.clock.runFor(100);
  const clear = await emptySpace(page);
  await page.mouse.move(clear.x, clear.y);
  await page.clock.runFor(60);
  await expect(view).not.toHaveAttribute("data-hover");
  await expect(view.locator("canvas"), "nothing to click there, links included").not.toHaveClass(/clickable/);
  await page.mouse.down();
  await page.mouse.up();
  await page.clock.runFor(1000);
  await page.clock.resume();
  const fitted = await still(page);
  await expect(view).toHaveAttribute("data-selected", "mem_demo015");
  await page.getByRole("button", { name: "Fit" }).click();
  expect(moved(await still(page), fitted), "Fit had gone all the way").toBeLessThan(3);
  await page.keyboard.press("Escape");
  await backTo(page, home);
  // A double click: one choice, and the camera all the way there. The second click comes 150 ms
  // into the flight, at the same point: whatever has moved under it since (another record, for
  // mem_demo001 and mem_demo003), it neither chooses another record nor stops the flight.
  for (const id of ["mem_demo020", "mem_demo001", "mem_demo003"]) {
    const s = (await sphere(page, id))!;
    await page.mouse.move(s.x, s.y);
    await expect(view).toHaveAttribute("data-hover", id);
    await page.waitForTimeout(2500);
    await page.clock.pauseAt(Date.now() + 1000);
    await page.mouse.down();
    await page.mouse.up();
    await page.clock.runFor(50);
    await expect(view).toHaveAttribute("data-selected", id);
    await page.clock.runFor(100);
    await page.mouse.down();
    await page.mouse.up();
    await page.clock.runFor(1000);
    await expect(view, `a double click on ${id}`).toHaveAttribute("data-selected", id);
    await page.clock.resume();
    await still(page);
    await page.keyboard.press("Escape");
    await backTo(page, home);
  }
  // From the keyboard: Enter, then Escape as soon as the panel is open (its Escape taken a
  // frame after it shows), the camera on its way.
  await view.focus();
  const before = await still(page);
  await page.keyboard.press("Enter");
  await expect(panel(page)).toBeVisible();
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/mem=/);
  await backTo(page, before);
});

test("Graph Memory in 3D: a click while the camera flies counts for the sphere it was pressed on; one on the chosen sphere lets the flight go on", async ({ page }) => {
  test.slow();
  await page.clock.install();
  await open(page, "?kn=memory");
  const view = constellation(page);
  await drawn(page);
  const home = await still(page);
  /** Moves the page's time on a frame at a time until the camera leaves `from`. */
  const takeOff = async (from: string | null) => {
    for (let i = 0; i < 30 && moved(await lens(page), from) < 0.5; i++) await page.clock.runFor(16);
    expect(moved(await lens(page), from), "on its way").toBeGreaterThan(0.5);
  };
  // Closing a record: on the way home, a press on the sphere moving fastest, held 200 ms. By the
  // release it has moved on from under the pointer; it is still what the click chooses.
  await clickSphere(page, "mem_demo016");
  await centred(page, "mem_demo016");
  const close = await lens(page);
  await page.waitForTimeout(2500);
  await page.clock.pauseAt(Date.now() + 1000);
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/mem=/);
  await takeOff(close);
  await page.clock.runFor(180);
  const drawnAt = () =>
    page.evaluate(() => {
      const box = document.querySelector(".mm3")!.getBoundingClientRect();
      return [...document.querySelectorAll<HTMLElement>(".mm3-label[data-sx]")].map((el) => ({ id: el.dataset.memId!, x: box.left + Number(el.dataset.sx), y: box.top + Number(el.dataset.sy) }));
    });
  const earlier = await drawnAt();
  await page.clock.runFor(32);
  const pressed = await page.evaluate((earlier) => {
    const box = document.querySelector(".mm3")!.getBoundingClientRect();
    let best = { id: "", x: 0, y: 0, speed: -1 };
    for (const el of document.querySelectorAll<HTMLElement>(".mm3-label[data-sx]")) {
      const [x, y] = [box.left + Number(el.dataset.sx), box.top + Number(el.dataset.sy)];
      const was = earlier.find((e) => e.id === el.dataset.memId);
      if (!was || document.elementFromPoint(x, y)?.tagName !== "CANVAS") continue;
      const speed = Math.hypot(x - was.x, y - was.y);
      if (speed > best.speed) best = { id: el.dataset.memId!, x, y, speed };
    }
    return best;
  }, earlier);
  expect(pressed.speed, "the spheres on the move").toBeGreaterThan(4);
  await page.mouse.move(pressed.x, pressed.y);
  await page.mouse.down();
  await page.clock.runFor(200);
  const left = (await sphere(page, pressed.id))!;
  expect(Math.hypot(left.x - pressed.x, left.y - pressed.y), `${pressed.id} has moved on from under the pointer`).toBeGreaterThan(left.r * 2.2);
  await page.mouse.up();
  await page.clock.runFor(50);
  await expect(view).toHaveAttribute("data-selected", pressed.id);
  await page.clock.resume();
  await centred(page, pressed.id);
  // Closing it returns to where the camera was going when it was chosen: the first place.
  await page.keyboard.press("Escape");
  await backTo(page, home);
  // A record's panel open (from its address, so nothing resizes the view), a sphere linked to it
  // chosen, and clicked again where it is 150 ms into the flight to it (the view has found it
  // under the pointer): the flight goes on rather than starting again, so the camera is there
  // half a second after it set off, and stays.
  await open(page, "?kn=memory&mem=mem_demo004");
  await drawn(page);
  const framed = await still(page);
  const s = (await sphere(page, "mem_demo011"))!;
  await page.mouse.move(s.x, s.y);
  await expect(view).toHaveAttribute("data-hover", "mem_demo011");
  await page.waitForTimeout(2500);
  await page.clock.pauseAt(Date.now() + 1000);
  await page.mouse.down();
  await page.mouse.up();
  await takeOff(framed);
  await page.clock.runFor(100);
  const on = (await sphere(page, "mem_demo011"))!;
  await page.mouse.move(on.x, on.y);
  await page.clock.runFor(50);
  await expect(view).toHaveAttribute("data-hover", "mem_demo011");
  await page.mouse.down();
  await page.mouse.up();
  await page.clock.runFor(420);
  const there = await lens(page);
  await page.clock.runFor(150);
  expect(moved(await lens(page), there), "there on time, not flown again").toBeLessThan(3);
  await expect(view).toHaveAttribute("data-selected", "mem_demo011");
  await page.clock.resume();
  expect(moved(await still(page), there), "and stays there").toBeLessThan(3);
  expect(await inView3d(page, ["mem_demo011", "mem_demo004"])).toBe(true);
  // A drag that starts outside the view and crosses it (selecting the panel's text) moves no
  // view: a flight under way goes on to the record. After it, a sphere under the pointer still
  // says so, and the next click chooses it.
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/mem=/);
  const overview = await flown(page, there);
  await clickSphere(page, "mem_demo016");
  await centred(page, "mem_demo016");
  await page.keyboard.press("Escape");
  await backTo(page, overview);
  const t = (await sphere(page, "mem_demo016"))!;
  await page.mouse.move(t.x, t.y);
  await expect(view).toHaveAttribute("data-hover", "mem_demo016");
  await page.waitForTimeout(2500);
  await page.clock.pauseAt(Date.now() + 1000);
  await page.mouse.down();
  await page.mouse.up();
  await takeOff(overview);
  const heading = (await panel(page).getByRole("heading").first().boundingBox())!;
  await page.mouse.move(heading.x + 10, heading.y + heading.height / 2);
  await page.mouse.down();
  const across = (await view.boundingBox())!;
  for (let i = 1; i <= 8; i++) await page.mouse.move(heading.x + 10 - (i * across.width) / 10, across.y + across.height / 2);
  await page.mouse.up();
  await page.clock.runFor(1500);
  await page.clock.resume();
  await centred(page, "mem_demo016");
  await clickSphere(page, "mem_demo015");
  await expect(view).toHaveAttribute("data-selected", "mem_demo015");
});

test("Graph Memory in 3D moves like a map: drag pans, right-drag turns, the wheel zooms to the pointer, and a drag or the wheel takes the camera off a flight", async ({ page }) => {
  test.slow();
  await page.clock.install();
  await open(page, "?kn=memory");
  const view = constellation(page);
  await drawn(page);
  const home = await still(page);
  const box = (await view.boundingBox())!;
  const empty = await emptySpace(page);
  expect(empty.d, "room to press").toBeGreaterThan(60);
  /** Where a sphere has come to rest after `act` moved it, at least `least` px. */
  const shifted = async (id: string, act: () => Promise<void>, least = 20) => {
    const from = (await sphere(page, id))!;
    await act();
    await expect.poll(async () => ((s) => Math.hypot(s.x - from.x, s.y - from.y))((await sphere(page, id))!), { timeout: 10_000 }).toBeGreaterThan(least);
    await still(page);
    const to = (await sphere(page, id))!;
    return { dx: to.x - from.x, dy: to.y - from.y, grew: to.r / from.r };
  };
  // A drag on empty space moves the spheres with it, and chooses nothing.
  let d = await shifted("mem_demo016", () => drag(page, empty, 120, 60));
  expect(d.dx).toBeGreaterThan(60);
  expect(d.dy).toBeGreaterThan(30);
  await expect(page).not.toHaveURL(/mem=/);
  // So does a drag that starts on a record's name.
  await expect(mark(page, "mem_demo004")).toHaveAttribute("data-show", "");
  const name = (await mark(page, "mem_demo004").boundingBox())!;
  d = await shifted("mem_demo016", () => drag(page, { x: name.x + name.width / 2, y: name.y + name.height / 2 }, -90, 50));
  expect(d.dx).toBeLessThan(-45);
  expect(d.dy).toBeGreaterThan(25);
  await expect(page).not.toHaveURL(/mem=/);
  // Right-drag turns the view round its centre: the camera looks from another side.
  const side = (at: string | null) => {
    const [x, , z, lx, , lz] = (at ?? "").split(/[,>]/).map(Number);
    return Math.atan2(x - lx, z - lz);
  };
  const facing = await still(page);
  await drag(page, { x: box.x + box.width / 2, y: box.y + box.height * 0.6 }, 160, 0, "right");
  await expect.poll(async () => Math.abs(side(await lens(page)) - side(facing)), { message: "turned", timeout: 10_000 }).toBeGreaterThan(0.15);
  await still(page);
  await expect(page).not.toHaveURL(/mem=/);
  // Fit frames everything again, from the front: where the view opened.
  await page.getByRole("button", { name: "Fit" }).click();
  await backTo(page, home, "fitted from the front");
  // The wheel zooms towards the pointer: the sphere under it grows and stays under it.
  const before = (await sphere(page, "mem_demo016"))!;
  await page.mouse.move(before.x, before.y);
  await page.mouse.wheel(0, -600);
  await expect.poll(async () => (await sphere(page, "mem_demo016"))!.r, { timeout: 10_000 }).toBeGreaterThan(before.r * 1.15);
  await still(page);
  const after = (await sphere(page, "mem_demo016"))!;
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(16);
  // Over a name the wheel does nothing.
  const zoomed = await still(page);
  const label = (await mark(page, "mem_demo016").boundingBox())!;
  await page.mouse.move(label.x + label.width / 2, label.y + label.height / 2);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(400);
  expect(moved(await still(page), zoomed), "the wheel over a name").toBeLessThan(1);
  // A turn of the wheel while Fit flies takes the camera over: the flight stops where it is.
  await page.waitForTimeout(2500);
  await page.clock.pauseAt(Date.now() + 1000);
  await page.getByRole("button", { name: "Fit" }).dispatchEvent("click");
  await page.clock.runFor(150);
  await page.mouse.move(empty.x, empty.y);
  await page.mouse.wheel(0, -200);
  await page.clock.runFor(1500);
  await page.clock.resume();
  expect(moved(await still(page), home), "Fit cut short by the wheel").toBeGreaterThan(20);
  // So does a drag: Fit again, and a drag on its way.
  await page.waitForTimeout(2500);
  await page.clock.pauseAt(Date.now() + 1000);
  await page.getByRole("button", { name: "Fit" }).dispatchEvent("click");
  await page.clock.runFor(150);
  await page.mouse.move(empty.x, empty.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(empty.x + i * 8, empty.y);
  await page.mouse.up();
  await page.clock.runFor(1500);
  await page.clock.resume();
  expect(moved(await still(page), home), "Fit cut short by a drag").toBeGreaterThan(20);
  await expect(page).not.toHaveURL(/mem=/);
});

test("Graph Memory in 3D: search flies to a record, a group or a day; filters and superseded versions change what is drawn", async ({ page }) => {
  test.slow();
  await open(page, "?kn=memory");
  const view = constellation(page);
  await drawn(page);
  const home = await still(page);
  const box = memorySearch(page);
  // A record by its title: Enter takes the first match, and the camera flies to it.
  await box.fill("fan fault");
  await expect(choices(page).first()).toContainText("Cooling tower 4 fan fault");
  await box.press("Enter");
  await expect(view).toHaveAttribute("data-selected", "mem_demo016");
  await expect(view).toHaveAttribute("data-mode", "focus");
  await centred(page, "mem_demo016");
  await expect(mark(page, "mem_demo016")).toHaveAttribute("data-state", "on");
  // Looked away, then found again: there again.
  const frame = (await view.boundingBox())!;
  await drag(page, { x: frame.x + frame.width * 0.5, y: frame.y + frame.height * 0.6 }, 260, 0);
  await still(page);
  expect(await offCentre(page, "mem_demo016")).toBeGreaterThan(0.15);
  await box.fill("fan fault");
  await box.press("Enter");
  await centred(page, "mem_demo016");
  // Closed, it flies back to where it was before the search.
  await panel(page).getByRole("button", { name: "Close panel" }).click();
  await expect(page).not.toHaveURL(/mem=/);
  await backTo(page, home);
  // An equipment item: its group framed and named, its records lit, the others faded; closed,
  // back where it was.
  await box.fill("tower");
  await choices(page).filter({ hasText: "Equipment: Cooling tower 4" }).click();
  await expect(page.locator('.mm3-lane[data-lane-key="cooling_towers_4"]')).toHaveClass(/mm3-lane--on/);
  await expect(panel(page).getByRole("heading", { name: "Cooling tower 4" })).toBeVisible();
  await flown(page, home);
  for (const id of ["mem_demo015", "mem_demo016", "mem_demo018"]) await expect(mark(page, id)).toHaveAttribute("data-state", "linked");
  expect(await inView3d(page, ["mem_demo015", "mem_demo016", "mem_demo018"])).toBe(true);
  expect(await page.locator('.mm3-label:not([data-lane="cooling_towers_4"])').evaluateAll((els) => els.length > 0 && els.every((e) => e.getAttribute("data-state") === "dim"))).toBe(true);
  await panel(page).getByRole("button", { name: "Close panel" }).click();
  await backTo(page, home);
  // A day: the camera goes to that day's records.
  const wide = Number(await view.getAttribute("data-distance"));
  await box.fill("1 Oct");
  await choices(page).filter({ hasText: "Go to 1 Oct 2026" }).click();
  await expect.poll(async () => Number(await view.getAttribute("data-distance"))).toBeLessThan(wide * 0.8);
  await still(page);
  expect(await inView3d(page, ["mem_demo015", "mem_demo016", "mem_demo018"])).toBe(true);
  // A kind: a filter; only those records drawn, framed again.
  await box.fill("decis");
  await choices(page).filter({ hasText: "Only decisions" }).click();
  await expect(filters(page)).toHaveAccessibleName("Filters (1 on)");
  await expect(page.locator(".mm3-label")).toHaveCount(2);
  await expect(view).toHaveAccessibleName("Memory constellation in 3D, 2 records and 0 links");
  await expect.poll(() => inView3d(page, ["mem_demo007", "mem_demo018"])).toBe(true);
  await filters(page).click();
  await page.getByRole("button", { name: "Clear filters" }).click();
  // Superseded versions on request: smaller, a ghost below the version that replaced it, and
  // it can be pointed at and chosen, with its history.
  await page.getByRole("checkbox", { name: "Include superseded versions" }).check();
  await filters(page).click();
  await expect(page.locator(".mm3-label")).toHaveCount(13);
  await drawn(page, 13);
  await expect.poll(() => inView3d(page, ["mem_demo001", "mem_demo002", "mem_demo021"])).toBe(true);
  await still(page);
  await expect(mark(page, "mem_demo002")).toHaveAttribute("data-status", "superseded");
  const [current, old] = [(await sphere(page, "mem_demo003"))!, (await sphere(page, "mem_demo002"))!];
  expect(old.r).toBeLessThan(current.r);
  expect(old.y).toBeGreaterThan(current.y);
  expect(Math.hypot(old.x - current.x, old.y - current.y), "clear of it").toBeGreaterThan(old.r + current.r);
  await page.mouse.move(old.x, old.y);
  await expect(view).toHaveAttribute("data-hover", "mem_demo002");
  await page.mouse.down();
  await page.mouse.up();
  await expect(page).toHaveURL(/mem=mem_demo002/);
  await expect(panel(page)).toContainText("Until 2026-09-29 10:15 UTC, then corrected.");
  await expect(mark(page, "mem_demo003")).toHaveAttribute("data-state", "linked");
  await panel(page).getByRole("button", { name: "Open the current version" }).click();
  await expect(view).toHaveAttribute("data-selected", "mem_demo003");
  await expect(panel(page).getByRole("heading", { name: "Chiller 2 condenser approach 4.2 K at 70% load" })).toBeVisible();
});

test("Graph Memory in 3D by keyboard: through time and across groups, a ring on the record, Enter flies to it and Escape back", async ({ page }) => {
  test.slow();
  await open(page, "?kn=memory");
  const view = constellation(page);
  await drawn(page);
  await still(page);
  // One tab stop, the latest record: tabbed to, it is ringed and said.
  await filters(page).focus();
  await page.keyboard.press("Tab");
  await expect(view).toBeFocused();
  await expect(view).toHaveAttribute("data-focused", "mem_demo021");
  const live = page.locator(".kn-3d-frame [aria-live]");
  await expect(live).toContainText("CW pump 4 vibration 2.1 mm/s during the rotation run");
  await expect(live).toContainText("Enter flies to it and opens it.");
  const ringOn = async (id: string) => {
    const [m, s, b] = [await marked(page), (await sphere(page, id))!, (await view.boundingBox())!];
    return Math.hypot(b.x + m.x - s.x, b.y + m.y - s.y);
  };
  await expect(page.locator(".kn-3d__ring")).toBeVisible();
  await expect.poll(() => ringOn("mem_demo021")).toBeLessThan(3);
  // Left and Right through time; Home and End; Down to the next group, nearest in time.
  await page.keyboard.press("ArrowLeft");
  await expect(view).toHaveAttribute("data-focused", "mem_demo020");
  await expect(live).toContainText("CW pump 4 standby rotation run");
  await page.keyboard.press("Home");
  await expect(view).toHaveAttribute("data-focused", "mem_demo001");
  await page.keyboard.press("ArrowRight");
  await expect(view).toHaveAttribute("data-focused", "mem_demo003");
  await page.keyboard.press("ArrowDown");
  await expect(view).toHaveAttribute("data-focused", "mem_demo015");
  await expect.poll(() => ringOn("mem_demo015")).toBeLessThan(3);
  // Shift with an arrow turns the view; the record stays the one under the ring.
  const before = await still(page);
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(async () => moved(await lens(page), before)).toBeGreaterThan(20);
  await expect(view).toHaveAttribute("data-focused", "mem_demo015");
  await expect.poll(() => ringOn("mem_demo015")).toBeLessThan(3);
  await page.keyboard.press("0");
  const fitted = await flown(page, await lens(page));
  // Enter flies to it and opens it; Escape flies back, and the record stays the tab stop.
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/mem=mem_demo015/);
  await expect(panel(page).getByRole("heading", { name: "Cooling tower 4 fan vibration rising" })).toBeFocused();
  await centred(page, "mem_demo015");
  // Moved away by hand before closing: still back to where it was.
  const frame = (await view.boundingBox())!;
  await drag(page, { x: frame.x + frame.width * 0.5, y: frame.y + frame.height * 0.6 }, 300, 120);
  await still(page);
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/mem=/);
  await expect(view).toBeFocused();
  await expect(view).toHaveAttribute("data-focused", "mem_demo015");
  await backTo(page, fitted);
  // + zooms in, − out, 0 fits it all again.
  const d = Number(await view.getAttribute("data-distance"));
  await page.keyboard.press("+");
  await expect.poll(async () => Number(await view.getAttribute("data-distance"))).toBeLessThan(d * 0.9);
  await page.keyboard.press("-");
  await page.keyboard.press("-");
  await expect.poll(async () => Number(await view.getAttribute("data-distance"))).toBeGreaterThan(d * 1.1);
  await page.keyboard.press("0");
  await backTo(page, fitted);
  // The browser's own keys stay the browser's: Ctrl with = (its zoom) is not taken.
  await page.evaluate(() => addEventListener("keydown", (e) => ((window as unknown as { taken: boolean }).taken = e.defaultPrevented)));
  await page.keyboard.press("Control+Equal");
  expect(await page.evaluate(() => (window as unknown as { taken: boolean }).taken)).toBe(false);
  expect(moved(await still(page), fitted)).toBeLessThan(3);
});

test("Graph Memory in 3D: a record's or a link's address opens on it, and closing shows everything", async ({ page }) => {
  test.slow();
  await open(page, "?kn=memory&mem=mem_demo009");
  const view = constellation(page);
  await drawn(page);
  await expect(view).toHaveAttribute("data-mode", "focus");
  await expect(panel(page).getByRole("heading", { name: "Simulated cleaning: Chiller 2 approach back to 2.9 K" })).toBeVisible();
  await centred(page, "mem_demo009");
  // Nothing to go back to: closing shows the whole constellation.
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/mem=/);
  const all = ["mem_demo001", "mem_demo003", "mem_demo004", "mem_demo007", "mem_demo009", "mem_demo011", "mem_demo013", "mem_demo015", "mem_demo016", "mem_demo018", "mem_demo020", "mem_demo021"];
  await expect.poll(() => inView3d(page, all), { timeout: 10_000 }).toBe(true);
  // A stored link: its two records lit and both in view, the rest faded.
  await open(page, "?kn=memory&mlink=lnk_demo012");
  await drawn(page);
  await expect(panel(page).getByRole("heading", { name: "Resolved by" })).toBeVisible();
  await expect(panel(page)).toContainText("A stored link, made 2026-10-02 15:20 UTC.");
  for (const id of ["mem_demo004", "mem_demo011"]) await expect(mark(page, id)).toHaveAttribute("data-state", "linked");
  await expect(mark(page, "mem_demo001")).toHaveAttribute("data-state", "dim");
  await expect.poll(() => inView3d(page, ["mem_demo004", "mem_demo011"]), { timeout: 10_000 }).toBe(true);
  // On to a record it joins.
  await panel(page).getByRole("button", { name: /^Chiller 2 condenser tubes cleaned and returned to service/ }).click();
  await expect(view).toHaveAttribute("data-selected", "mem_demo011");
  await expect(page).not.toHaveURL(/mlink=/);
});

test("Graph Memory without WebGL is the timeline in 2D, and says why", async ({ page }) => {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      return type.startsWith("webgl") ? null : (get as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof get;
  });
  for (const q of ["?kn=memory", "?kn=memory&mv=3d"]) {
    await open(page, q);
    await expect(page.getByText("This browser cannot draw in 3D (WebGL is unavailable), so the timeline is shown in 2D.")).toBeVisible();
    await expect(page.getByRole("radio", { name: "3D" })).toBeDisabled();
    await expect(timeline(page).locator(".mm-node")).toHaveCount(12);
    await expect(constellation(page)).toHaveCount(0);
  }
  // Everything is still explored there: search, a record and its panel, the list.
  await memorySearch(page).fill("fouling");
  await memorySearch(page).press("Enter");
  await expect(record(page, "mem_demo004")).toHaveAttribute("aria-pressed", "true");
  await expect(panel(page).getByRole("heading", { name: "Condenser tube fouling likely on Chiller 2" })).toBeVisible();
  await page.getByRole("radio", { name: "List" }).click();
  await expect(page.locator(".kn-entry")).toHaveCount(12);
});

test("Graph Memory hands over to the timeline when 3D stops or cannot start, and says which", async ({ page }) => {
  test.slow();
  const stopped = "The 3D view stopped (the browser lost its graphics context), so the timeline is shown in 2D.";
  const unstarted = "The 3D view could not start here (the browser could not set up its graphics, or the view did not load), so the timeline is shown in 2D.";
  // The graphics context lost while the constellation is shown, a record chosen: the timeline,
  // the record still chosen, its panel open.
  await open(page, "?kn=memory&mem=mem_demo004");
  await drawn(page);
  await page.evaluate(() => document.querySelector<HTMLCanvasElement>(".mm3 canvas")!.getContext("webgl2")!.getExtension("WEBGL_lose_context")!.loseContext());
  await expect(page.getByText(stopped)).toBeVisible();
  await expect(timeline(page).locator(".mm-node")).toHaveCount(12);
  await expect(record(page, "mem_demo004")).toHaveAttribute("aria-pressed", "true");
  await expect(panel(page).getByRole("heading", { name: "Condenser tube fouling likely on Chiller 2" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "3D" })).toBeDisabled();
  // The 3D view's code not loading, or its graphics not starting (the check before it passed):
  // the timeline, never a loading state left on screen.
  for (const setup of [
    (p: Page) => p.route(/MemoryConstellation/, (route) => route.abort()),
    (p: Page) =>
      p.addInitScript(() => {
        const get = HTMLCanvasElement.prototype.getContext;
        let made = 0;
        HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
          return type.startsWith("webgl") && made++ > 0 ? null : (get as (...a: unknown[]) => unknown).call(this, type, ...rest);
        } as typeof get;
      }),
  ]) {
    const p = await page.context().newPage();
    await setup(p);
    await open(p, "?kn=memory");
    await expect(p.getByText(unstarted)).toBeVisible();
    await expect(timeline(p).locator(".mm-node")).toHaveCount(12);
    await expect(p.locator(".kn-3d-loading")).toHaveCount(0);
    await expect(p.getByRole("radio", { name: "3D" })).toBeDisabled();
    await memorySearch(p).fill("fouling");
    await memorySearch(p).press("Enter");
    await expect(record(p, "mem_demo004")).toHaveAttribute("aria-pressed", "true");
    await p.close();
  }
});

test("Graph Memory in 3D frames the constellation again when resized after a choice is closed, and when a phone's width lays it out again", async ({ page }) => {
  test.slow();
  await open(page, "?kn=memory");
  const view = constellation(page);
  await drawn(page);
  const home = await still(page);
  const all = ["mem_demo001", "mem_demo003", "mem_demo004", "mem_demo007", "mem_demo009", "mem_demo011", "mem_demo013", "mem_demo015", "mem_demo016", "mem_demo018", "mem_demo020", "mem_demo021"];
  await clickSphere(page, "mem_demo016");
  await centred(page, "mem_demo016");
  await page.keyboard.press("Escape");
  await backTo(page, home);
  // Narrower and shorter: framed again (the camera moves), every record in view.
  await page.setViewportSize({ width: 1100, height: 700 });
  await expect.poll(async () => moved(await lens(page), home), { message: "framed again", timeout: 10_000 }).toBeGreaterThan(20);
  await expect.poll(() => inView3d(page, all), { timeout: 10_000 }).toBe(true);
  // A slow drag of the window, a few pixels at a time, each seen on its own, adds up and frames
  // it again too (its height: at this shape the height is what bounds the framing).
  const framed = await still(page);
  for (let h = 695; h >= 670; h -= 5) {
    await page.setViewportSize({ width: 1100, height: h });
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  }
  await expect.poll(async () => moved(await lens(page), framed), { message: "framed again after a slow resize", timeout: 10_000 }).toBeGreaterThan(5);
  // Moved far off by hand, then narrower than a phone's breakpoint, which lays the records out
  // again: framed again.
  const box = (await view.boundingBox())!;
  await drag(page, { x: box.x + box.width * 0.6, y: box.y + box.height * 0.6 }, -box.width * 0.5, 0);
  await still(page);
  expect(await inView3d(page, all)).toBe(false);
  await page.setViewportSize({ width: 600, height: 800 });
  await expect.poll(() => inView3d(page, all), { timeout: 10_000 }).toBe(true);
});

/** Counts the page's WebGL draw calls from its start; returns how many so far. */
async function countDraws(page: Page) {
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
  return () => page.evaluate(() => (window as unknown as { draws: number }).draws);
}
/** Waits until nothing is drawn for 600 ms. */
const nothingDrawn = (page: Page, draws: () => Promise<number>) =>
  expect
    .poll(
      async () => {
        const before = await draws();
        await page.waitForTimeout(600);
        return (await draws()) - before;
      },
      { timeout: 10_000 },
    )
    .toBe(0);

test("Graph Memory in 3D with reduced motion: the camera is there at once, and nothing is drawn while no one is about", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const draws = await countDraws(page);
  await open(page, "?kn=memory");
  const view = constellation(page);
  await drawn(page);
  await expect.poll(draws).toBeGreaterThan(0);
  // Idle: no drift, nothing drawn at all.
  await nothingDrawn(page, draws);
  // A click: the camera is at the record at once, with no motion under way.
  const home = await lens(page);
  await clickSphere(page, "mem_demo016");
  await expect(view).toHaveAttribute("data-selected", "mem_demo016");
  await expect.poll(() => offCentre(page, "mem_demo016")).toBeLessThan(0.12);
  expect(await page.evaluate(() => document.documentElement.dataset.motion ?? null)).toBeNull();
  await page.keyboard.press("Escape");
  await expect.poll(async () => moved(await lens(page), home)).toBeLessThan(3);
});

test("Graph Memory in 3D drawn in software (no graphics processor) does not drift: it rests while no one is about", async ({ page }) => {
  const draws = await countDraws(page);
  await open(page, "?kn=memory");
  await drawn(page);
  const gl = await page.evaluate(() => {
    const gl = document.querySelector<HTMLCanvasElement>(".mm3 canvas")!.getContext("webgl2")!;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    return { renderer: String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)), antialias: gl.getContextAttributes()?.antialias };
  });
  test.skip(!/swiftshader|llvmpipe|softpipe|basic render|software/i.test(gl.renderer), `drawn by a graphics processor here (${gl.renderer})`);
  // Drawn without multisampling, half of each frame's cost there.
  expect(gl.antialias).toBe(false);
  // Without reduced motion the spheres would drift for a while; drawn in software, they rest.
  await expect.poll(draws).toBeGreaterThan(0);
  await nothingDrawn(page, draws);
  // Looking round still draws.
  const box = (await constellation(page).boundingBox())!;
  const before = await draws();
  await drag(page, { x: box.x + box.width / 2, y: box.y + box.height * 0.6 }, 60, 0);
  await expect.poll(draws).toBeGreaterThan(before);
});

test("Graph Memory in 3D: a choice and its clearing recolour the links and arrows, rebuilding no link, arrow or sphere", async ({ page }) => {
  // three.js announces each scene it makes to its devtools hook; the graph library tags its
  // link, arrow and node objects.
  await page.addInitScript(() => {
    const w = window as unknown as { scenes: unknown[]; __THREE_DEVTOOLS__: EventTarget };
    w.scenes = [];
    w.__THREE_DEVTOOLS__ = new EventTarget();
    w.__THREE_DEVTOOLS__.addEventListener("observe", (e) => (e as CustomEvent<{ isScene?: boolean }>).detail?.isScene && w.scenes.push((e as CustomEvent).detail));
  });
  await open(page, "?kn=memory");
  const view = constellation(page);
  await drawn(page);
  const home = await still(page);
  // Keeps the scene's links, arrows and spheres as they are now; then counts those made since.
  const keep = () =>
    page.evaluate(() => {
      type Obj = { __graphObjType?: string; __linkThreeObjType?: string; traverse: (fn: (o: Obj) => void) => void; isPoints?: boolean };
      const w = window as unknown as { scenes: Obj[]; kept?: Set<Obj> };
      const scene = w.scenes.find((s) => {
        let has = false;
        s.traverse((o) => (has ||= Boolean(o.isPoints)));
        return has;
      })!;
      const now = new Set<Obj>();
      scene.traverse((o) => (o.__graphObjType === "link" || o.__graphObjType === "node" || o.__linkThreeObjType === "arrow") && now.add(o));
      const made = w.kept ? [...now].filter((o) => !w.kept!.has(o)).length : 0;
      w.kept = now;
      return { count: now.size, made };
    });
  // Nine links with their arrows, twelve spheres.
  expect((await keep()).count).toBe(30);
  await clickSphere(page, "mem_demo004");
  await expect(view).toHaveAttribute("data-selected", "mem_demo004");
  await expect(mark(page, "mem_demo001")).toHaveAttribute("data-state", "linked");
  await still(page);
  expect(await keep()).toEqual({ count: 30, made: 0 });
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/mem=/);
  await backTo(page, home);
  expect(await keep()).toEqual({ count: 30, made: 0 });
});

test.describe("Graph Memory in 3D on a touch screen", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test("a tap chooses a sphere, one finger moves the view and chooses nothing, two pinch", async ({ page }) => {
    test.slow();
    await open(page, "?kn=memory");
    const view = constellation(page);
    await drawn(page);
    const home = await still(page);
    const box = (await view.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", points: { x: number; y: number; id: number }[]) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
    // One finger drags the view along, and chooses nothing.
    const from = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.55 };
    await touch("touchStart", [{ ...from, id: 0 }]);
    for (let i = 1; i <= 8; i++) await touch("touchMove", [{ x: from.x + i * 8, y: from.y + i * 4, id: 0 }]);
    await touch("touchEnd", []);
    const panned = await still(page);
    expect(moved(panned, home)).toBeGreaterThan(10);
    await expect(page).not.toHaveURL(/mem=/);
    // Two fingers spreading zoom in.
    const d = Number(await view.getAttribute("data-distance"));
    const [cx, cy] = [box.x + box.width / 2, box.y + box.height * 0.5];
    await touch("touchStart", [{ x: cx - 30, y: cy, id: 0 }, { x: cx + 30, y: cy, id: 1 }]);
    for (let i = 1; i <= 10; i++) await touch("touchMove", [{ x: cx - 30 - i * 8, y: cy, id: 0 }, { x: cx + 30 + i * 8, y: cy, id: 1 }]);
    await touch("touchEnd", []);
    await expect.poll(async () => Number(await view.getAttribute("data-distance"))).toBeLessThan(d * 0.8);
    // A tap on a sphere (a finger down for a moment, as a finger is) chooses it: the camera
    // flies to it and the panel opens.
    await page.getByRole("button", { name: "Fit" }).click();
    await still(page);
    const s = (await sphere(page, "mem_demo016"))!;
    await touch("touchStart", [{ x: s.x, y: s.y, id: 0 }]);
    await page.waitForTimeout(80);
    await touch("touchEnd", []);
    await expect(view).toHaveAttribute("data-selected", "mem_demo016");
    await expect(panel(page).getByRole("heading", { name: "Cooling tower 4 fan fault limits heat rejection in the heat-wave simulation" })).toBeVisible();
    await expect.poll(() => inView3d(page, ["mem_demo016"])).toBe(true);
  });
});

test("Graph Memory in forced colours: the drawing takes the system colours", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await open(page, "?kn=memory");
  await expect(timeline(page)).toBeVisible();
  // It opens as the timeline in 2D, which follows them, and says so; 3D stays a choice.
  await expect(page.getByText(/High-contrast mode is on, so the memory graph opens as the timeline in 2D/)).toBeVisible();
  await expect(page.getByRole("radio", { name: "3D" })).toBeEnabled();
  const c = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "CanvasText";
    document.body.append(probe);
    const text = getComputedStyle(probe).color;
    probe.remove();
    const css = (selector: string, property: string) => getComputedStyle(document.querySelector(selector)!).getPropertyValue(property);
    return { text, day: css(".mm-axis__day", "fill"), orb: css(".mm-node__orb", "stroke"), run: css(".mm-run__name", "fill") };
  });
  expect(c.day).toBe(c.text);
  expect(c.orb).toBe(c.text);
  expect(c.run).toBe(c.text);
});

test("Graph Memory's list: the same records, latest first, with provenance, the filters and history", async ({ page }) => {
  await open(page, "?kn=memory");
  await page.getByRole("radio", { name: "List" }).click();
  await expect(page).toHaveURL(/mv=list/);
  await expect(page.getByRole("radio", { name: "List" })).toBeFocused();
  const entries = page.locator(".kn-entry");
  await expect(entries).toHaveCount(12);
  await expect(entries.first()).toContainText("CW pump 4 vibration 2.1 mm/s during the rotation run");
  const simulated = entries.filter({ has: page.locator(".kn-entry__title", { hasText: "Simulated cleaning" }) });
  await expect(simulated.locator(".tag-chip")).toHaveText("Simulation · RUN-0002");
  // A day found by search: the list goes there.
  await memorySearch(page).fill("29 Sep");
  await choices(page).filter({ hasText: "Go to 29 Sep 2026" }).click();
  await expect.poll(() => page.locator(".mm-list").evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await expect(page.locator("#kn-day-2026-09-29")).toBeInViewport();
  // The same filters: equipment, then superseded versions too.
  await filters(page).click();
  await page.getByRole("combobox", { name: "Equipment" }).selectOption("chiller_plant_2");
  await expect(entries).toHaveCount(7);
  await expect(entries.first()).toContainText("After “Chiller 2 condenser tubes cleaned and returned to service” on Chiller 2");
  await page.getByRole("checkbox", { name: "Include superseded versions" }).check();
  await expect(entries).toHaveCount(8);
  await filters(page).click();
  const old = page.locator(".kn-entry--old");
  await expect(old).toContainText("Chiller 2 condenser approach 4.8 K at 70% load");
  await old.click();
  await expect(panel(page)).toContainText("Until 2026-09-29 10:15 UTC, then corrected.");
  // On to the timeline, the same record chosen and the same filters on.
  await page.getByRole("radio", { name: "Timeline" }).click();
  await expect(page).toHaveURL(/mv=timeline/);
  await expect(record(page, "mem_demo002")).toHaveAttribute("aria-pressed", "true");
  await expect(timeline(page).locator(".mm-node")).toHaveCount(8);
  // And to 3D, the default, which leaves the address.
  await page.getByRole("radio", { name: "3D" }).click();
  await expect(page).not.toHaveURL(/mv=/);
  await expect(constellation(page)).toBeVisible();
  await expect(mark(page, "mem_demo002")).toHaveAttribute("data-state", "on");
  // The memory graph's old address opens the constellation.
  await open(page, "?kn=memory&mv=graph");
  await expect(constellation(page)).toBeVisible();
});

test("on a phone Graph Memory keeps every lane in view, counts what waits for zoom, and keeps its controls within reach", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "?kn=memory&mv=timeline");
  await expect(timeline(page)).toBeVisible();
  await settled(page);
  for (const key of ["chiller_plant_2", "cooling_towers_4", "cooling_water_pump_4"]) await expect(page.locator(`.mm-lane__name[data-lane-key="${key}"]`)).toBeInViewport();
  for (const control of [memorySearch(page), filters(page), page.getByRole("button", { name: "Help" }), page.getByRole("button", { name: "Fit" })]) await expect(control).toBeInViewport();
  // Crowded records wait for zoom, counted on the record beside them; the count zooms in.
  const host = timeline(page).locator(".mm-node", { has: page.locator(".mm-node__more") }).first();
  await expect(host).toHaveAccessibleName(/\d more records? close by: zoom in to see/);
  const id = (await host.getAttribute("data-mem-id"))!;
  const k = await zoom(page);
  await host.locator(".mm-node__more").click();
  await expect.poll(() => zoom(page)).toBeGreaterThan(k * 1.5);
  await settled(page);
  await expect(record(page, id)).not.toHaveAccessibleName(/close by/);
  await page.getByRole("button", { name: "Fit" }).click();
  await expect.poll(() => zoom(page)).toBeCloseTo(k, 2);
  // A record found: the panel below, the record and its lane's name above it.
  await memorySearch(page).fill("fouling");
  await memorySearch(page).press("Enter");
  await expect(panel(page).getByRole("heading", { name: "Condenser tube fouling likely on Chiller 2" })).toBeInViewport();
  await expect.poll(() => inFrame(page, "mem_demo004")).toBe(true);
  await expect(page.locator('.mm-lane__name[data-lane-key="chiller_plant_2"]')).toBeInViewport();
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
  await tab(page, "Memory graph").click();
  await expect(constellation(page).locator("canvas")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dataset.motion ?? null)).toBeNull();
  // Found by search, a record is in view at once with the records it is linked to, without
  // flying.
  await memorySearch(page).fill("fouling");
  await memorySearch(page).press("Enter");
  await expect(constellation(page)).toHaveAttribute("data-selected", "mem_demo004");
  await expect.poll(() => inView3d(page, ["mem_demo004", "mem_demo001", "mem_demo003", "mem_demo007", "mem_demo011"])).toBe(true);
  expect(await page.evaluate(() => document.documentElement.dataset.motion ?? null)).toBeNull();
  // And on the timeline.
  await page.getByRole("radio", { name: "Timeline" }).click();
  await expect(page).toHaveURL(/mv=timeline/);
  await expect(timeline(page)).toBeVisible();
  await memorySearch(page).fill("fouling");
  await memorySearch(page).press("Enter");
  await expect(record(page, "mem_demo004")).toHaveAttribute("aria-pressed", "true");
  expect(await inFrame(page, "mem_demo004")).toBe(true);
  expect(await page.evaluate(() => document.documentElement.dataset.motion ?? null)).toBeNull();
});

test("no horizontal overflow on a phone", async ({ page }) => {
  // Six pages, four of them drawing the 3D graph in software: slow under the full suite.
  test.slow();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const q of ["", "?kv=library", "?kv=search&q=fouling", "?node=ent_fault_condenser_fouling", "?kn=memory", "?kn=memory&mem=mem_demo004"]) {
    await open(page, q);
    await settled(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), q).toBe(0);
  }
});

test("Graph Memory on a phone: nothing overflows sideways, its filters included", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const q of ["?kn=memory&mlink=lnk_demo008", "?kn=memory&mv=list"]) {
    await open(page, q);
    await settled(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), q).toBe(0);
  }
  await open(page, "?kn=memory");
  await filters(page).click();
  const popover = page.getByRole("group", { name: "Memory filters and legend" });
  expect(await popover.evaluate((el) => [...el.querySelectorAll("select, input, button")].every((c) => c.getBoundingClientRect().right <= el.getBoundingClientRect().right))).toBe(true);
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

/** Graph Memory's controls, open over a view: the search's choices, the filters, help. */
async function memoryControlsChecked(page: Page, q: string) {
  await memorySearch(page).fill("chill");
  expect(await serious(page), `${q} search choices`).toEqual([]);
  await page.keyboard.press("Escape");
  await filters(page).click();
  expect(await serious(page), `${q} filters`).toEqual([]);
  await filters(page).click();
  await page.getByRole("button", { name: "Help" }).click();
  expect(await serious(page), `${q} help`).toEqual([]);
}

test("no serious accessibility violations in Graph Memory's constellation: its panels, its controls and a phone", async ({ page }) => {
  test.slow();
  for (const q of ["?kn=memory", "?kn=memory&mlink=lnk_demo008", "?kn=memory&mem=equipment:cooling_towers_4", "?kn=memory&mem=run:RUN-0002"]) {
    await open(page, q);
    await drawn(page);
    expect(await serious(page), q).toEqual([]);
  }
  await open(page, "?kn=memory");
  await drawn(page);
  await memoryControlsChecked(page, "?kn=memory");
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "?kn=memory");
  await drawn(page);
  expect(await serious(page), "a phone").toEqual([]);
});

test("no serious accessibility violations in Graph Memory's timeline and list: their panels, their controls and a phone", async ({ page }) => {
  test.slow();
  for (const q of ["?kn=memory&mv=timeline", "?kn=memory&mv=timeline&mlink=lnk_demo008", "?kn=memory&mv=timeline&mem=equipment:cooling_towers_4", "?kn=memory&mv=list"]) {
    await open(page, q);
    await expect(page.locator(".kn-loading")).toHaveCount(0);
    expect(await serious(page), q).toEqual([]);
  }
  await open(page, "?kn=memory&mv=timeline");
  await expect(timeline(page)).toBeVisible();
  await memoryControlsChecked(page, "?kn=memory&mv=timeline");
  // A phone's timeline, with records waiting for zoom.
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "?kn=memory&mv=timeline");
  await expect(timeline(page).locator(".mm-node__more").first()).toBeVisible();
  expect(await serious(page), "a phone").toEqual([]);
});
