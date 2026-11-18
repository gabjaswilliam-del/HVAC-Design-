import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CadStudioPage } from "./CadStudioPage";
import { cad } from "./cadSession";

describe("CAD Studio demo", () => {
  class ResizeObserverStub {
    observe() {}
    disconnect() {}
  }

  afterEach(() => {
    cleanup();
    cad.reset(); // the session outlives the page, as it does across navigation
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  const openSample = () => {
    expect(screen.getByRole("heading", { name: /Projects/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Water-cooled plant/i }));
    expect(screen.getByRole("heading", { name: "Preparing workspace" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  };
  const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(`^${name}`) });

  it("opens the labelled sample on its drawing and keeps connection findings editable in the review", () => {
    vi.useFakeTimers();
    render(<CadStudioPage />);

    expect(screen.queryByText("No CAD parser connected")).toBeNull();
    openSample();

    expect(screen.getByRole("heading", { name: "Water-cooled plant", level: 2 })).toBeTruthy();
    expect(screen.getAllByText("Prepared sample").length).toBeGreaterThan(0);
    expect(tab("Drawing").getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Object inspector" })).toBeNull(); // the drawing has the area

    // The source drawing beside the extraction, in one pan and zoom.
    fireEvent.click(screen.getByRole("button", { name: "Source drawing beside the extraction" }));
    expect(screen.getByRole("group", { name: "Synthetic source drawing" })).toBeTruthy();
    const splitter = screen.getByRole("separator", { name: "Resize comparison panels" });
    expect(splitter.getAttribute("aria-valuenow")).toBe("50");
    fireEvent.keyDown(splitter, { key: "ArrowRight" });
    expect(splitter.getAttribute("aria-valuenow")).toBe("55");
    fireEvent.click(screen.getByRole("button", { name: "Source drawing beside the extraction" }));

    // Selecting equipment opens the review: its own evidence and its connections are separate rows.
    const scene = screen.getByRole("group", { name: "Plant scene" });
    fireEvent.click(within(scene).getByRole("button", { name: /CW pump 4/i }));
    expect(screen.getByRole("complementary", { name: "Object inspector" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /CW pump 4/, level: 3 })).toBeTruthy();
    expect(screen.getByText("Connections needing review")).toBeTruthy();
    expect(screen.getByText("1 of 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Evidence" }));
    expect(screen.getByRole("combobox", { name: "Equipment evidence" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Back to findings/ }));

    fireEvent.click(screen.getByRole("button", { name: /Unknown connection/ }));
    expect(screen.getByText("CW pump 4:discharge")).toBeTruthy();
    expect(screen.getByText("Condenser-water supply header")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Evidence" }), { target: { value: "confirmed" } });
    fireEvent.click(screen.getByRole("button", { name: /Back to findings/ }));
    expect(screen.queryByRole("button", { name: /Unknown connection/ })).toBeNull();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Unconnected port/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Connect from" }), { target: { value: "chiller_plant_2" } });
    fireEvent.click(screen.getByRole("button", { name: "Create connection" }));
    expect(screen.getByText("Chiller 2:evap_out")).toBeTruthy();
    expect(screen.getByText("CHW pump 4:suction")).toBeTruthy();
    expect(document.querySelector(".cad-inspector .cad-evidence")?.textContent).toBe("Confirmed");
    fireEvent.click(screen.getByRole("button", { name: /Back to findings/ }));
    expect(screen.queryByRole("button", { name: /Unconnected port/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close review" }));
    expect(screen.queryByRole("complementary", { name: "Object inspector" })).toBeNull();
  }, 10_000);

  it("uploads a drawing as a project without pretending it was parsed", async () => {
    const { container } = render(<CadStudioPage />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).toBeTruthy();

    const drawing = new File(["AC1032 fixture"], "mechanical-room.dwg", { type: "application/acad" });
    fireEvent.change(input!, { target: { files: [drawing] } });

    expect(await screen.findByRole("heading", { name: "mechanical-room.dwg", level: 3 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "mechanical-room", level: 2 })).toBeTruthy();
    expect(screen.getAllByText("No extraction").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Parser not connected/)).toBeNull();
    expect(screen.queryByRole("group", { name: "Synthetic source drawing" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull(); // nothing to review in a file
    expect(screen.getByRole("button", { name: "Upload" })).toBeTruthy(); // the one upload in a project
  });

  it("previews the reviewed draft in the shared Overview viewport", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 1000, height: 700, top: 0, left: 0, right: 1000, bottom: 700, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      measureText: (text: string) => ({ width: text.length * 7 }),
    } as CanvasRenderingContext2D);
    render(<CadStudioPage />);
    openSample();
    fireEvent.click(screen.getByRole("button", { name: "Preview in Overview" }));

    expect(screen.getByRole("heading", { name: "Overview preview" })).toBeTruthy();
    expect(screen.getAllByText("CAD draft").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Draft scene · not validated or commissioned").length).toBeGreaterThan(0);
    expect(screen.queryByText("Unavailable")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Chiller 1/i }));
    expect(screen.getAllByText("Confirmed").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Back to review" }));
    expect(screen.getByRole("heading", { name: "Water-cooled plant", level: 2 })).toBeTruthy();
  });

  it("has no 3D view: Drawing, History and Compare, with versions compared against an approved reference", async () => {
    render(<CadStudioPage />);
    openSample();
    expect(screen.queryByRole("radio", { name: "3D" })).toBeNull();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(expect.arrayContaining(["Drawing", "History", "Compare"]));

    fireEvent.click(tab("History"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save version" })); });
    expect(await screen.findByText("Version 1")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Set Version 1 as the approved reference" })); });
    expect(screen.getByText("Approved reference")).toBeTruthy();

    // Change the working review, then compare it with the reference.
    act(() => {
      cad.select({ kind: "link", id: cad.current().topology.links.find((l) => l.evidence === "unknown")!.id });
      cad.setEvidence("confirmed");
    });
    fireEvent.click(tab("Compare"));
    expect(await screen.findByText("1 changed")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Side by side" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Differences" }));
    expect(document.querySelectorAll('.cad-diff [data-diff="changed"]').length).toBeGreaterThan(0);
  });
});
