import { describe, expect, it } from "vitest";
import { displayRequest, SHOW_ON_DISPLAY_TOOL } from "./display";

const t = "2026-09-28T07:15:00.000Z";
const ok = (content: unknown) => displayRequest.safeParse({ title: "Shown", content }).success;

describe("the AI display contract", () => {
  it("accepts each kind of content", () => {
    expect(ok({ kind: "line", unit: "kW", series: [{ label: "Power", points: [{ t, v: 1 }, { t, v: null }] }] })).toBe(true);
    expect(ok({ kind: "bar", unit: "kW", bars: [{ label: "Chiller 1", value: 120.5 }] })).toBe(true);
    expect(ok({ kind: "table", columns: [{ key: "a", label: "A" }], rows: [{ a: "x" }, { a: 2 }, { a: null }] })).toBe(true);
    expect(ok({ kind: "stats", items: [{ label: "COP", value: "4.2" }] })).toBe(true);
    expect(ok({ kind: "image", src: "data:image/png;base64,iVBORw0KGgo=", alt: "A chart" })).toBe(true);
    expect(ok({ kind: "html", html: "<p>Hello</p>", height: 300 })).toBe(true);
  });

  it("takes an image only inline, never a link to fetch or an SVG that could carry script", () => {
    expect(ok({ kind: "image", src: "https://example.com/chart.png", alt: "x" })).toBe(false);
    expect(ok({ kind: "image", src: "data:image/svg+xml;base64,PHN2Zz4=", alt: "x" })).toBe(false);
    expect(ok({ kind: "image", src: "data:image/png;base64,iVBOR w0KGgo=", alt: "x" })).toBe(false);
  });

  it("rejects what it cannot draw: unknown kinds, empty series, untimed points", () => {
    expect(ok({ kind: "video", src: "x" })).toBe(false);
    expect(ok({ kind: "line", unit: "kW", series: [] })).toBe(false);
    expect(ok({ kind: "line", unit: "kW", series: [{ label: "x", points: [{ t: "yesterday", v: 1 }] }] })).toBe(false);
    expect(displayRequest.safeParse({ title: "", content: { kind: "stats", items: [{ label: "a", value: "1" }] } }).success).toBe(false);
  });

  it("publishes one MCP tool whose input schema is the payload's own", () => {
    expect(SHOW_ON_DISPLAY_TOOL.name).toBe("show_on_display");
    const schema = SHOW_ON_DISPLAY_TOOL.inputSchema as { type: string; required: string[]; properties: Record<string, unknown> };
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(expect.arrayContaining(["title", "content"]));
    expect(Object.keys(schema.properties).sort()).toEqual(["caption", "content", "title"]);
  });
});
