/**
 * The AI display: the Overview's second view, where the assistant shows what it retrieved
 * instead of moving the operator to another screen. The assistant has one tool for it,
 * `show_on_display`, published as an MCP tool (name, description and JSON input schema
 * below), so a local model harness calls it like any other tool. The harness streams each
 * call as a `display` event and the dashboard draws it.
 *
 * Nothing in a payload can reach the dashboard itself:
 * - charts, bars, tables and figures are data, drawn by the dashboard's own components;
 * - an image is a base64 `data:` URI (PNG, JPEG or WebP), never a link to fetch;
 * - HTML the model writes is shown in a sandboxed frame with its own opaque origin, no
 *   access to the dashboard, no network (a content security policy blocks it) and no
 *   navigation. It can run its own scripts, for a chart it draws itself.
 */
import { z } from "zod";
import { isoTime } from "./common";

const label = z.string().min(1).max(80);
const value = z.number().finite().nullable();

const lineSeries = z.object({
  label,
  /** Dashed lines are reserved for forecasts and other estimates. */
  dashed: z.boolean().optional(),
  points: z.array(z.object({ t: isoTime, v: value })).max(2000),
});

export const displayContent = z.discriminatedUnion("kind", [
  /** Values over time: one to six series on a shared time axis. */
  z.object({
    kind: z.literal("line"),
    unit: z.string().max(12),
    decimals: z.number().int().min(0).max(3).optional(),
    series: z.array(lineSeries).min(1).max(6),
    /** A shaded range, such as a forecast's spread. */
    band: z.object({ label, points: z.array(z.object({ t: isoTime, lo: value, hi: value })).max(2000) }).optional(),
  }),
  /** One value per category, compared side by side. */
  z.object({
    kind: z.literal("bar"),
    unit: z.string().max(12),
    decimals: z.number().int().min(0).max(3).optional(),
    bars: z.array(z.object({ label, value })).min(1).max(40),
  }),
  /** Rows of readings or records. Cells are text or numbers, never markup. */
  z.object({
    kind: z.literal("table"),
    columns: z.array(z.object({ key: z.string().min(1).max(40), label, align: z.enum(["start", "end"]).optional() })).min(1).max(12),
    rows: z.array(z.record(z.string(), z.union([z.string().max(400), z.number(), z.null()]))).max(500),
  }),
  /** A few headline figures. */
  z.object({
    kind: z.literal("stats"),
    items: z.array(z.object({ label, value: z.string().min(1).max(40), note: z.string().max(160).optional() })).min(1).max(12),
  }),
  /** An image the model produced, inline. */
  z.object({
    kind: z.literal("image"),
    src: z
      .string()
      .max(6_000_000)
      .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/, "An image is a base64 PNG, JPEG or WebP data URI."),
    alt: z.string().min(1).max(300),
  }),
  /** A page the model wrote itself, shown sandboxed. */
  z.object({
    kind: z.literal("html"),
    html: z.string().min(1).max(500_000),
    /** Frame height in CSS pixels. */
    height: z.number().int().min(120).max(1600).optional(),
  }),
]);
export type DisplayContent = z.infer<typeof displayContent>;

/** What the assistant sends: the `show_on_display` tool's input. */
export const displayRequest = z.object({
  title: z.string().min(1).max(120),
  /** One or two sentences: what is shown, for when, and from which data. */
  caption: z.string().max(600).optional(),
  content: displayContent,
});
export type DisplayRequest = z.infer<typeof displayRequest>;

/** What the dashboard keeps and draws: the request, and where and when it came from. */
export const displayItem = displayRequest.extend({
  id: z.string().min(1),
  shownAt: isoTime,
  source: z.object({
    /** Who sent it: the assistant in a conversation. */
    kind: z.literal("assistant"),
    conversationId: z.string().nullable(),
    /** The data behind it is the demo's synthetic data. */
    demo: z.boolean(),
  }),
});
export type DisplayItem = z.infer<typeof displayItem>;

/** The MCP tool the assistant calls. The input schema is generated from `displayRequest`,
 *  so the tool and the dashboard can never disagree about a payload. */
export const SHOW_ON_DISPLAY_TOOL = {
  name: "show_on_display",
  description:
    "Show data on the operator's AI display (the Overview's second view) instead of moving them to another screen. " +
    "Use a line chart for values over time, bars to compare items, a table for records, stats for a few headline figures, " +
    "an image (base64 PNG, JPEG or WebP) or a self-contained HTML page. Every figure must come from a tool result. " +
    "The newest call replaces what is shown; earlier ones stay one step away.",
  inputSchema: z.toJSONSchema(displayRequest),
} as const;
