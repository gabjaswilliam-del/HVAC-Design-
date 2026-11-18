import { afterEach, describe, expect, it } from "vitest";
import { demoScene, demoTopology } from "../../fixtures/demoPlant";
import { ApiError } from "../../lib/api/client";
import type { CadProjectsClient } from "../../lib/api/cadProjects";
import { memoryCadProjects } from "../../lib/api/cadProjectsMemory";
import type { ProjectState } from "../../lib/contracts/cadProject";
import { cad, compareSides, isDirty, openFindings, referenceId, WORKING } from "./cadSession";

afterEach(() => cad.reset());

const unknownLink = demoTopology.links.find((link) => link.evidence === "unknown")!;
const STEPS = 3;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const dwg = (name: string, body = "AC1032 drawing") => new File([body], name);

/** The tab's own project service, with every call recorded. */
function service() {
  const client = memoryCadProjects();
  const calls: string[] = [];
  const spied = Object.fromEntries(
    Object.entries(client).map(([name, fn]) => [name, (...args: unknown[]) => (calls.push(name === "save" ? `save@${(args[1] as { expectedRevision: number }).expectedRevision}` : name), (fn as (...a: unknown[]) => unknown)(...args))]),
  ) as unknown as CadProjectsClient;
  cad.useClient(spied);
  return { client, calls };
}

describe("CAD session: the prepared sample's review", () => {
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

  it("locating a finding shows the drawing with the review open, and asks the viewport to move once per request", () => {
    cad.request({ kind: "sample" }, STEPS);
    cad.setTab("compare");
    cad.locateFinding({ kind: "device", id: "chiller_plant_1" }, "chiller_plant_1");
    cad.locateFinding({ kind: "device", id: "chiller_plant_1" }, "chiller_plant_1");
    expect(cad.current()).toMatchObject({ tab: "drawing", reviewOpen: true, viewing: null, locate: { id: "chiller_plant_1", nonce: 2 } });
  });

  it("layers, colours and the source view never change the review or make it dirty", () => {
    cad.request({ kind: "sample" }, STEPS);
    cad.setLayer("cw", false);
    cad.setColourBy("review");
    cad.setSourceCompare(true);
    expect(cad.current()).toMatchObject({ layers: { cw: false }, colourBy: "review", sourceCompare: true });
    expect(isDirty(cad.current())).toBe(false);
  });
});

describe("CAD session: projects on a project service", () => {
  it("the first save creates the project; later saves carry its revision; a stale save is a conflict", async () => {
    const { client, calls } = service();
    cad.request({ kind: "sample" }, STEPS);
    cad.skip(STEPS);
    cad.select({ kind: "link", id: unknownLink.id });
    cad.setEvidence("confirmed");
    cad.setSourceCompare(true);
    cad.placement.compareSplit = 60;

    await cad.save("Plant review A");
    const first = cad.current().project!;
    expect(first).toMatchObject({ name: "Plant review A", kind: "sample" });
    expect(first.id).toMatch(/^cadp_/);
    expect(isDirty(cad.current())).toBe(false);
    const stored = await client.open(first.id!);
    expect(stored.project.source).toEqual({ kind: "sample", sampleId: "water-cooled-plant", sceneRevision: demoScene.sceneRevision, configRevision: demoTopology.configRevision });
    expect(stored.state.workspace).toMatchObject({ view: "compare", compareSplit: 60, selection: { kind: "link", id: unknownLink.id } });
    expect(stored.project.review).toEqual({ openFindings: openFindings(demoTopology) - 1 });

    cad.setEvidence("inferred");
    await cad.save();
    expect(calls).toContain("save@1");
    expect(cad.current().project?.summary?.revision).toBe(2);

    await client.rename(first.id!, "Renamed elsewhere", 2); // another tab
    cad.setEvidence("unknown");
    await cad.save();
    expect(cad.current().failure).toMatchObject({ conflict: true });
    expect(isDirty(cad.current())).toBe(true);
  });

  it("Save As makes a new project with the unsaved review; rename and delete follow the open one", async () => {
    const { client } = service();
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
    expect((await client.open(original)).state.review?.topology.links.find((l) => l.id === unknownLink.id)?.evidence).toBe("unknown");

    await cad.rename("Branch 2");
    expect(cad.current().project?.name).toBe("Branch 2");
    expect(cad.current().library.projects.find((p) => p.id === branch.id)?.name).toBe("Branch 2");

    await cad.remove(branch.id!);
    expect(cad.current()).toMatchObject({ project: null, screen: "library" });
    expect(cad.current().library.projects.map((p) => p.id)).toEqual([original]);
  });

  it("opening a saved project restores its review, selection, divider and viewport", async () => {
    service();
    cad.request({ kind: "sample" }, STEPS);
    cad.select({ kind: "device", id: "chiller_plant_2" });
    cad.placement.viewports.drawing = { view: { k: 2, x: -100, y: -50 }, box: { w: 800, h: 600 } };
    await cad.save("Saved view");
    const id = cad.current().project!.id!;
    cad.close();
    await cad.loadLibrary();
    expect(cad.current().library.projects.map((p) => p.id)).toEqual([id]);

    cad.request({ kind: "saved", id }, STEPS);
    await settle();
    expect(cad.current()).toMatchObject({ screen: "studio", tab: "drawing", sourceCompare: false, selection: { kind: "device", id: "chiller_plant_2" } });
    expect(cad.placement.restore).toEqual({ view: "drawing", cx: 250, cy: 175, scale: 2 });
  });

  it("an older project saved in the removed 3D view reopens on the 2D drawing; its source comparison is kept", async () => {
    const { client } = service();
    cad.request({ kind: "sample" }, STEPS);
    await cad.save("Legacy");
    const id = cad.current().project!.id!;
    const saved = (await client.open(id)).state;
    const legacy = (view: "model" | "compare"): ProjectState => ({
      ...saved,
      workspace: { ...saved.workspace, view, model: { target: [0, 1, 0], azimuth: 45, polar: 35, zoom: 1 }, drawing: { cx: 10, cy: 20, scale: 1.5 } },
    });
    await client.save(id, { expectedRevision: 1, state: legacy("model"), openFindings: 0 });
    cad.close(true);
    cad.request({ kind: "saved", id }, STEPS);
    await settle();
    expect(cad.current()).toMatchObject({ screen: "studio", tab: "drawing", sourceCompare: false });
    expect(cad.placement.restore).toEqual({ view: "drawing", cx: 10, cy: 20, scale: 1.5 });
    await cad.save();
    expect((await client.open(id)).state.workspace).not.toHaveProperty("model");

    await client.save(id, { expectedRevision: 3, state: legacy("compare"), openFindings: 0 });
    cad.close(true);
    cad.request({ kind: "saved", id }, STEPS);
    await settle();
    expect(cad.current()).toMatchObject({ tab: "drawing", sourceCompare: true });
    expect(cad.placement.restore).toMatchObject({ view: "source" });
  });

  it("an uploaded drawing opens as a stored file, its version 1, with no reference chosen", async () => {
    const { calls } = service();
    await cad.importFiles([dwg("mech.dwg")]);
    await settle();
    expect(calls.filter((c) => c === "upload")).toHaveLength(1);
    expect(cad.current().project).toMatchObject({ kind: "drawing", name: "mech", original: { available: true } });
    expect(cad.current().history.versions.map((v) => v.number)).toEqual([1]);
    expect(referenceId(cad.current())).toBeNull();
    expect(isDirty(cad.current())).toBe(false);
  });

  it("uploads never discard unsaved review work without asking", async () => {
    service();
    cad.request({ kind: "sample" }, STEPS);
    cad.select({ kind: "link", id: unknownLink.id });
    cad.setEvidence("confirmed");
    await cad.importFiles([dwg("floor-a.dwg"), dwg("floor-b.dxf", "0\nSECTION")]);
    expect(cad.current().library.projects.map((p) => p.name).sort()).toEqual(["floor-a", "floor-b"]);
    expect(cad.current().discard).toMatchObject({ kind: "saved" });
    expect(cad.current().project?.key).toBe("sample");
    cad.confirmDiscard(STEPS);
    await settle();
    expect(cad.current().project).toMatchObject({ kind: "drawing", name: "floor-a", original: { extension: "dwg" } });
  });

  it("one upload workflow: drawings only, as projects or as versions that never move the reference", async () => {
    service();
    await cad.upload([dwg("plant.dwg"), new File(["%PDF"], "spec.pdf")], "projects");
    await settle();
    expect(cad.current().project).toMatchObject({ name: "plant" });
    expect(cad.current().failure?.message).toBe("Only DWG and DXF drawings can be uploaded. Not uploaded: spec.pdf.");
    const [v1] = cad.current().history.versions;
    await cad.setReference(v1.id);
    cad.setTab("compare");
    await cad.upload([dwg("plant-b.DXF", "0\nSECTION"), new File(["x"], "photo.png")], "revision");
    expect(cad.current().tab).toBe("history");
    expect(cad.current().history.versions.map((v) => v.number)).toEqual([1, 2]);
    expect(referenceId(cad.current())).toBe(v1.id);
    expect(cad.current().failure?.message).toMatch(/photo\.png/);
    expect(cad.current().library.projects).toHaveLength(1);
  });

  it("refuses files that are not DWG or DXF", async () => {
    service();
    await cad.importFiles([new File(["%PDF"], "notes.pdf")]);
    expect(cad.current().failure?.message).toMatch(/DWG and DXF/);
    expect(cad.current().project).toBeNull();
  });
});

describe("CAD session: history, the approved reference and Compare", () => {
  it("saving a version freezes the review; the reference is chosen explicitly and never moved by a new version", async () => {
    service();
    cad.request({ kind: "sample" }, STEPS);
    await cad.saveVersion("Plant review");
    const [v1] = cad.current().history.versions;
    expect(v1).toMatchObject({ number: 1, source: { kind: "review" }, review: { openFindings: openFindings(demoTopology) } });
    expect(referenceId(cad.current())).toBeNull();

    await cad.setReference(v1.id);
    expect(referenceId(cad.current())).toBe(v1.id);

    cad.select({ kind: "link", id: unknownLink.id });
    cad.setEvidence("confirmed");
    await cad.saveVersion();
    await cad.uploadRevision(dwg("rev-c.dwg"));
    expect(cad.current().history.versions.map((v) => v.number)).toEqual([1, 2, 3]);
    expect(referenceId(cad.current())).toBe(v1.id);
    expect(cad.current().project?.summary?.versions).toBe(3);

    // Compare: the approved reference against the working review, unless chosen otherwise.
    expect(compareSides(cad.current())).toEqual({ reference: v1.id, target: WORKING });
    const v2 = cad.current().history.versions[1];
    cad.compareWith(v2.id);
    expect(cad.current().tab).toBe("compare");
    expect(compareSides(cad.current())).toEqual({ reference: v1.id, target: v2.id });
    await cad.loadReview(v2.id);
    expect(cad.current().reviews[v2.id]?.links.find((l) => l.id === unknownLink.id)?.evidence).toBe("confirmed");
    const upload = cad.current().history.versions[2];
    await cad.loadReview(upload.id);
    expect(cad.current().reviews[upload.id]).toBeNull();
  });

  it("a reference change from a stale tab is refused, and clearing it is explicit", async () => {
    const { client } = service();
    cad.request({ kind: "sample" }, STEPS);
    await cad.saveVersion("Plant review");
    await cad.saveVersion();
    const [v1, v2] = cad.current().history.versions;
    const id = cad.current().project!.id!;
    await client.rename(id, "Elsewhere", cad.current().project!.summary!.revision);
    await cad.setReference(v2.id);
    expect(cad.current().failure).toMatchObject({ conflict: true });
    expect(referenceId(cad.current())).toBeNull();
    cad.close(true);
    cad.request({ kind: "saved", id }, STEPS);
    await settle();
    await cad.setReference(v1.id);
    expect(referenceId(cad.current())).toBe(v1.id);
    await cad.setReference(null);
    expect(referenceId(cad.current())).toBeNull();
  });

  it("viewing a saved version is read-only: its evidence cannot be edited", async () => {
    service();
    cad.request({ kind: "sample" }, STEPS);
    await cad.saveVersion("Plant review");
    const [v1] = cad.current().history.versions;
    cad.viewVersion(v1.id);
    expect(cad.current()).toMatchObject({ tab: "drawing", viewing: v1.id });
    cad.select({ kind: "link", id: unknownLink.id });
    cad.setEvidence("confirmed");
    cad.resolvePort(demoTopology.unconnectedPorts[0], "chiller_plant_2");
    expect(isDirty(cad.current())).toBe(false);
    cad.viewVersion(null);
    expect(cad.current().viewing).toBeNull();
  });

  it("duplicating a project keeps its history and the same approved reference", async () => {
    const { client } = service();
    await cad.importFiles([dwg("plant.dwg")]);
    await settle();
    await cad.uploadRevision(dwg("plant-b.dwg", "AC1032 revision B"));
    const [, v2] = cad.current().history.versions;
    await cad.setReference(v2.id);
    const id = cad.current().project!.id!;
    await cad.duplicate(id, "Plant copy");
    const copy = cad.current().library.projects.find((p) => p.name === "Plant copy")!;
    const versions = await client.versions(copy.id);
    expect(versions.map((v) => v.number)).toEqual([1, 2]);
    expect(copy.referenceVersionId).toBe(versions[1].id);
    expect(copy.referenceVersionId).not.toBe(v2.id);
  });

  it("the tab's service refuses stale writes like the local one", async () => {
    const client = memoryCadProjects();
    const made = await client.upload(dwg("a.dwg"));
    await expect(client.setReference(made.project.id, null, 7)).rejects.toBeInstanceOf(ApiError);
    await expect(client.version(made.project.id, "cadv_0000000000000000")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
