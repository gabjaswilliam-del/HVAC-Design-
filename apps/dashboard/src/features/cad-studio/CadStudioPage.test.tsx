import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CadStudioPage } from "./CadStudioPage";

describe("CAD Studio demo", () => {
  class ResizeObserverStub {
    observe() {}
    disconnect() {}
  }

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("opens the labelled sample and keeps connection findings editable in the scene", () => {
    vi.useFakeTimers();
    render(<CadStudioPage />);

    expect(screen.getByText("No CAD parser connected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Water-cooled plant/i }));
    expect(screen.getByRole("heading", { name: "Preparing workspace" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    expect(screen.getByRole("heading", { name: "CAD Studio" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Topology" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Review" })).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Compare" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("group", { name: "Synthetic source drawing" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Plant scene" })).toBeTruthy();
    expect(screen.queryByRole("slider")).toBeNull();
    const splitter = screen.getByRole("separator", { name: "Resize comparison panels" });
    expect(splitter.getAttribute("aria-valuenow")).toBe("50");
    fireEvent.keyDown(splitter, { key: "ArrowRight" });
    expect(splitter.getAttribute("aria-valuenow")).toBe("55");
    expect(screen.queryByText("Wheel to zoom")).toBeNull();
    expect(screen.getAllByLabelText("Recognition status").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /CW pump 4/i }));
    expect(screen.getByText("2 connections highlighted on canvas")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Unknown connection/ }));
    expect(screen.getByText("CW pump 4:discharge")).toBeTruthy();
    expect(screen.getByText("Condenser-water supply header")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Evidence" }), { target: { value: "confirmed" } });
    expect(screen.queryByRole("button", { name: /Unknown connection/ })).toBeNull();
    expect(screen.getByText("Unsaved")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Unconnected port/ }));
    expect(screen.getByRole("combobox", { name: "Connect from" })).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Connect from" }), { target: { value: "chiller_plant_2" } });
    fireEvent.click(screen.getByRole("button", { name: "Create connection" }));
    expect(screen.queryByRole("button", { name: /Unconnected port/ })).toBeNull();
    expect(screen.getByText("Chiller 2:evap_out")).toBeTruthy();
    expect(screen.getByText("CHW pump 4:suction")).toBeTruthy();
    expect(document.querySelector(".cad-inspector .cad-evidence")?.textContent).toBe("Confirmed");
  }, 10_000);

  it("accepts a local drawing without pretending the parser is connected", () => {
    const { container } = render(<CadStudioPage />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).toBeTruthy();

    const drawing = new File(["fixture"], "mechanical-room.dwg", { type: "application/acad" });
    fireEvent.change(input!, { target: { files: [drawing] } });

    expect(screen.getByText("mechanical-room.dwg")).toBeTruthy();
    expect(screen.getByText(/Parser not connected/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Water-cooled plant/i })).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: /Water-cooled plant/i }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview in Overview" }));

    expect(screen.getByRole("heading", { name: "Overview preview" })).toBeTruthy();
    expect(screen.getAllByText("CAD draft").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Draft scene · not validated or commissioned").length).toBeGreaterThan(0);
    expect(screen.queryByText("Unavailable")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Chiller 1/i }));
    expect(screen.getAllByText("Confirmed").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Back to review" }));
    expect(screen.getByRole("heading", { name: "CAD Studio" })).toBeTruthy();
  });
});
