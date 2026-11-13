import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

  it("opens the labelled sample and keeps connection findings editable in the scene", () => {
    vi.useFakeTimers();
    render(<CadStudioPage />);

    expect(screen.queryByText("No CAD parser connected")).toBeNull();
    openSample();

    expect(screen.getByRole("heading", { name: "Water-cooled plant", level: 2 })).toBeTruthy();
    expect(screen.getAllByText("Prepared sample").length).toBeGreaterThan(0);
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Compare" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("group", { name: "Synthetic source drawing" })).toBeTruthy();
    const scene = screen.getByRole("group", { name: "Plant scene" });
    const splitter = screen.getByRole("separator", { name: "Resize comparison panels" });
    expect(splitter.getAttribute("aria-valuenow")).toBe("50");
    fireEvent.keyDown(splitter, { key: "ArrowRight" });
    expect(splitter.getAttribute("aria-valuenow")).toBe("55");
    expect(screen.getAllByLabelText("Recognition status").length).toBeGreaterThan(0);

    // Equipment: its own evidence and the review of its connections are separate rows.
    fireEvent.click(within(scene).getByRole("button", { name: /CW pump 4/i }));
    expect(screen.getByRole("heading", { name: /CW pump 4/, level: 3 })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Equipment evidence" })).toBeTruthy();
    expect(screen.getByText("Connections needing review")).toBeTruthy();
    expect(screen.getByText("1 of 2")).toBeTruthy();
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
  }, 10_000);

  it("accepts a local drawing without pretending the parser is connected", () => {
    const { container } = render(<CadStudioPage />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).toBeTruthy();

    const drawing = new File(["fixture"], "mechanical-room.dwg", { type: "application/acad" });
    fireEvent.change(input!, { target: { files: [drawing] } });

    expect(screen.getByRole("heading", { name: "mechanical-room.dwg", level: 3 })).toBeTruthy();
    expect(screen.getAllByText("No extraction").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Parser not connected/)).toBeNull();
    expect(screen.queryByRole("group", { name: "Synthetic source drawing" })).toBeNull();
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
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

  it("offers 3D and keeps the page usable when WebGL2 is unavailable", () => {
    render(<CadStudioPage />);
    openSample();
    fireEvent.click(screen.getByRole("radio", { name: "3D" }));
    expect(screen.getByText("3D is unavailable in this browser. Showing the 2D drawing.")).toBeTruthy();
    expect(screen.getAllByRole("group", { name: "Synthetic source drawing" }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("radio", { name: "Compare" }));
    expect(screen.getByRole("group", { name: "Plant scene" })).toBeTruthy();
  });
});
