import { afterEach, describe, expect, it } from "vitest";
import { demoScene, demoTopology } from "../../fixtures/demoPlant";
import { ApiError } from "../../lib/api/client";
import type { CadProjectsClient } from "../../lib/api/cadProjects";
import type { ProjectState, ProjectSummary } from "../../lib/contracts/cadProject";
import { cad, isDirty, openFindings } from "./cadSession";

afterEach(() => cad.reset());

const unknownLink = demoTopology.links.find((link) => link.evidence === "unknown")!;
const STEPS = 3;

/** An in-memory project service with the real one's revision rules. */
function fakeService() {
  const projects = new Map<string, { summary: ProjectSummary; state: ProjectState }>();
  let next = 0;
  const calls: string[] = [];
  const now = () => new Date(Date.UTC(2026, 10, 13, 10, next)).toISOString();
  const make = (name: string, state: ProjectState, source: ProjectSummary["source"]) => {
    const id = `cadp_${(++next).toString(16).padStart(16, "0")}`;
    const summary: ProjectSummary = { id, name, createdAt: now(), modifiedAt: now(), lastOpenedAt: now(), revision: 1, source, review: state.review ? { openFindings: openFindings(state.review.topology) } : null };
    projects.set(id, { summary, state });
    return { project: summary, state };
  };
  const client: CadProjectsClient = {
    status: async () => ({ available: true, schemaVersion: 1, limits: { maxUploadBytes: 64 << 20, maxStateBytes: 1 << 20, maxNameLength: 120, extensions: ["dwg", "dxf"] } }),
    list: async () => [...projects.values()].map((p) => p.summary),
    create: async ({ name, state, sceneRevision, configRevision }) => (calls.push("create"), make(name, state, { kind: "sample", sampleId: "water-cooled-plant", sceneRevision, configRevision })),
    upload: async (file) => (calls.push("upload"), make(file.name, { schemaVersion: 1, workspace: { view: "drawing", selection: null, compareSplit: 50, layers: { cw: true, chw: true, valves: true, instruments: true, names: true }, colourBy: "medium" }, review: null }, { kind: "upload", original: { name: file.name, extension: "dwg", sizeBytes: file.size, sha256: "0".repeat(64), available: true } })),
    open: async (id) => {
      const p = projects.get(id)!;
      return { project: p.summary, state: p.state };
    },
    save: async (id, { expectedRevision, state }) => {
      calls.push(`save@${expectedRevision}`);
      const p = projects.get(id)!;
      if (p.summary.revision !== expectedRevision) throw new ApiError("CONFLICT", "changed elsewhere", false);
      p.summary = { ...p.summary, revision: p.summary.revision + 1 };
      p.state = state;
      return p.summary;
    },
    rename: async (id, name, expectedRevision) => {
      const p = projects.get(id)!;
      if (p.summary.revision !== expectedRevision) throw new ApiError("CONFLICT", "changed elsewhere", false);
      p.summary = { ...p.summary, name, revision: p.summary.revision + 1 };
      return p.summary;
    },
    copy: async (id, name, saved) => (calls.push("copy"), make(name, saved?.state ?? projects.get(id)!.state, projects.get(id)!.summary.source)),
    remove: async (id) => void projects.delete(id),
    originalUrl: (id) => `/api/cad/v1/projects/${id}/original`,
  };
  return { client, projects, calls };
}

describe("CAD session, demo mode", () => {
  it("replays the sample's extraction once; reopening it resumes the same review", () => {
    cad.request({ kind: "sample" }, STEPS);
    expect(cad.current().screen).toBe("extract");
    for (let i = 0; i <= STEPS; i++) cad.advance(STEPS);
    expect(cad.current().screen).toBe("studio");
    cad.select({ kind: "link", id: unknownLink.id });
    cad.setEvidence("confirmed");
    cad.show("library");
    cad.request({ kind: "sample" }, STEPS);
    expect(cad.current().screen).toBe("studio");
    expect(cad.current().topology.links.find((l) => l.id === unknownLink.id)?.evidence).toBe("confirmed");
  });

  it("keeps the review (evidence, created connections) and reverts to the sample", () => {
    cad.request({ kind: "sample" }, STEPS);
    cad.select({ kind: "link", id: unknownLink.id });
    cad.setEvidence("confirmed");
    expect(isDirty(cad.current())).toBe(true);
    const port = demoTopology.unconnectedPorts[0];
    cad.resolvePort(port, "chiller_plant_2");
    expect(cad.current().topology.unconnectedPorts).toHaveLength(demoTopology.unconnectedPorts.length - 1);
    expect(cad.current().selection).toEqual({ kind: "link", id: `manual_chiller_plant_2_${port.device}_${port.port}` });
    cad.revert();
    expect(isDirty(cad.current())).toBe(false);
  });

  it("imports drawings into this tab; with unsaved changes it asks before opening one", async () => {
    cad.request({ kind: "sample" }, STEPS);
    cad.select({ kind: "link", id: unknownLink.id });
    cad.setEvidence("confirmed");
    await cad.importFiles([new File(["AC1032"], "floor-a.dwg"), new File(["0\nSECTION"], "floor-b.dxf")], STEPS);
    expect(cad.current().drawings.map((d) => d.file.name)).toEqual(["floor-a.dwg", "floor-b.dxf"]);
    expect(cad.current().discard).toEqual({ kind: "drawing", key: "file:0" });
    expect(cad.current().project?.key).toBe("sample");
    cad.confirmDiscard(STEPS);
    expect(cad.current().project).toMatchObject({ kind: "drawing", name: "floor-a.dwg", original: { extension: "dwg", sizeBytes: 6 } });
  });

  it("reissues an already-selected camera preset for toolbar and canvas controls", () => {
    cad.setPreset("plan");
    expect(cad.current()).toMatchObject({ preset: "plan", presetRevision: 1 });
    cad.setPreset("plan");
    expect(cad.current()).toMatchObject({ preset: "plan", presetRevision: 2 });
  });

  it("locating a finding shows Compare and asks the viewport to move, once per request", () => {
    cad.request({ kind: "sample" }, STEPS);
    cad.setView("drawing");
    cad.locateFinding({ kind: "device", id: "chiller_plant_1" }, "chiller_plant_1");
    cad.locateFinding({ kind: "device", id: "chiller_plant_1" }, "chiller_plant_1");
    expect(cad.current()).toMatchObject({ view: "compare", locate: { id: "chiller_plant_1", nonce: 2 } });
  });
});

describe("CAD session, local project service", () => {
  it("the first save creates the project; later saves carry its revision; a stale save is a conflict", async () => {
    const service = fakeService();
    cad.useClient(service.client);
    cad.request({ kind: "sample" }, STEPS);
    cad.skip(STEPS);
    cad.select({ kind: "link", id: unknownLink.id });
    cad.setEvidence("confirmed");
    cad.placement.compareSplit = 60;

    await cad.save("Plant review A");
    const first = cad.current().project!;
    expect(first).toMatchObject({ name: "Plant review A", kind: "sample" });
    expect(first.id).toMatch(/^cadp_/);
    expect(isDirty(cad.current())).toBe(false);
    const stored = service.projects.get(first.id!)!;
    expect(stored.summary.source).toEqual({ kind: "sample", sampleId: "water-cooled-plant", sceneRevision: demoScene.sceneRevision, configRevision: demoTopology.configRevision });
    expect(stored.state.workspace).toMatchObject({ view: "compare", compareSplit: 60, selection: { kind: "link", id: unknownLink.id } });
    expect(stored.summary.review).toEqual({ openFindings: openFindings(demoTopology) - 1 });

    cad.setEvidence("inferred");
    await cad.save();
    expect(service.calls).toContain("save@1");
    expect(cad.current().project?.summary?.revision).toBe(2);

    const stale = service.projects.get(first.id!)!;
    stale.summary = { ...stale.summary, revision: 9 }; // saved from another tab
    cad.setEvidence("unknown");
    await cad.save();
    expect(cad.current().failure).toMatchObject({ conflict: true });
    expect(isDirty(cad.current())).toBe(true);
  });

  it("Save As makes a new project with the unsaved review; rename and delete follow the open one", async () => {
    const service = fakeService();
    cad.useClient(service.client);
    cad.request({ kind: "sample" }, STEPS);
    await cad.save("Original");
    const original = cad.current().project!.id!;
    cad.select({ kind: "link", id: unknownLink.id });
    cad.setEvidence("confirmed");
    await cad.saveAs("Branch");
    const branch = cad.current().project!;
    expect(branch.id).not.toBe(original);
    expect(branch.name).toBe("Branch");
    expect(isDirty(cad.current())).toBe(false);
    expect(service.projects.get(original)!.state.review?.topology.links.find((l) => l.id === unknownLink.id)?.evidence).toBe("unknown");

    await cad.rename("Branch 2");
    expect(cad.current().project?.name).toBe("Branch 2");
    expect(cad.current().library.projects.find((p) => p.id === branch.id)?.name).toBe("Branch 2");

    await cad.remove(branch.id!);
    expect(cad.current()).toMatchObject({ project: null, screen: "library" });
    expect(cad.current().library.projects.map((p) => p.id)).toEqual([original]);
  });

  it("opening a saved project restores its review, view, selection, divider and viewport", async () => {
    const service = fakeService();
    cad.useClient(service.client);
    cad.request({ kind: "sample" }, STEPS);
    cad.setView("drawing");
    cad.select({ kind: "device", id: "chiller_plant_2" });
    cad.placement.viewports.drawing = { view: { k: 2, x: -100, y: -50 }, box: { w: 800, h: 600 } };
    await cad.save("Saved view");
    const id = cad.current().project!.id!;
    cad.close();
    await cad.loadLibrary();
    expect(cad.current().library.projects.map((p) => p.id)).toEqual([id]);

    cad.request({ kind: "saved", id }, STEPS);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cad.current()).toMatchObject({ screen: "studio", view: "drawing", selection: { kind: "device", id: "chiller_plant_2" } });
    expect(cad.placement.restore).toEqual({ view: "drawing", cx: 250, cy: 175, scale: 2 });
  });

  it("keeps selection across views and reopens a saved model view safely on 2D", async () => {
    const service = fakeService();
    cad.useClient(service.client);
    cad.request({ kind: "sample" }, STEPS);
    cad.select({ kind: "device", id: "chiller_plant_1" });
    cad.setView("model");
    expect(cad.current()).toMatchObject({ view: "model", selection: { kind: "device", id: "chiller_plant_1" } });
    cad.setView("compare");
    expect(cad.current()).toMatchObject({ view: "compare", selection: { kind: "device", id: "chiller_plant_1" } });
    cad.setView("model");
    await cad.save("Model view");
    const id = cad.current().project!.id!;
    expect(service.projects.get(id)!.state.workspace.view).toBe("model");
    cad.close();
    cad.request({ kind: "saved", id }, STEPS);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cad.current()).toMatchObject({ screen: "studio", view: "drawing", selection: { kind: "device", id: "chiller_plant_1" } });
  });

  it("keeps M3b layer and finding behavior in session without changing the review or making it dirty", () => {
    cad.request({ kind: "sample" }, STEPS);
    cad.setView("model");
    cad.setLayer("cw", false);
    cad.setColourBy("review");
    cad.setPreset("plan");
    expect(cad.current()).toMatchObject({ view: "model", layers: { cw: false }, colourBy: "review", preset: "plan" });
    expect(isDirty(cad.current())).toBe(false);
    cad.locateFinding({ kind: "device", id: "cooling_water_pump_4" }, "cooling_water_pump_4");
    expect(cad.current()).toMatchObject({ view: "model", selection: { kind: "device", id: "cooling_water_pump_4" } });
    expect(cad.current().locate?.nonce).toBe(1);
  });

  it("an uploaded drawing opens as a stored file with no review", async () => {
    const service = fakeService();
    cad.useClient(service.client);
    await cad.importFiles([new File(["AC1032"], "mech.dwg")], STEPS);
    expect(service.calls).toEqual(["upload"]);
    expect(cad.current().project).toMatchObject({ kind: "drawing", name: "mech.dwg", original: { available: true } });
    expect(isDirty(cad.current())).toBe(false);
  });
});
