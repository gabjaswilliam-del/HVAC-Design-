/**
 * Files sent with a question. Text files only, read in this browser and sent with the
 * question as text: nothing is uploaded anywhere else, and no file is opened, run or
 * rendered. The offline assistant describes what a file contains from its text alone;
 * figures it reports are computed from the file, never estimated.
 */
import type { AttachmentInput } from "../contracts/agent";
import { formatNumber } from "../format";
import { mentions, type Vocabulary } from "./understand";

export const MAX_FILES = 3;
export const MAX_BYTES = 512 * 1024;
export const EXTENSIONS = [".txt", ".md", ".csv", ".tsv", ".json", ".log"];

export type AttachmentProblem = { name: string; code: "too_many" | "duplicate" | "type" | "size" | "binary" | "unreadable" };

const extensionOf = (name: string) => (name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "");
/** NUL characters, or more than a sprinkling of undecodable bytes, mean it is not text. */
const looksBinary = (text: string) => text.includes("\u0000") || (text.match(/�/g)?.length ?? 0) > 2 + text.length / 100;

export async function readAttachments(files: File[], current: AttachmentInput[]) {
  const added: AttachmentInput[] = [];
  const problems: AttachmentProblem[] = [];
  for (const f of files) {
    const fail = (code: AttachmentProblem["code"]) => problems.push({ name: f.name, code });
    if (current.length + added.length >= MAX_FILES) fail("too_many");
    else if ([...current, ...added].some((a) => a.name === f.name && a.size === f.size)) fail("duplicate");
    else if (!EXTENSIONS.includes(extensionOf(f.name))) fail("type");
    else if (f.size > MAX_BYTES) fail("size");
    else {
      let text: string;
      try {
        text = await f.text();
      } catch {
        fail("unreadable");
        continue;
      }
      if (looksBinary(text)) fail("binary");
      else added.push({ name: f.name, type: f.type || "text/plain", size: f.size, text });
    }
  }
  return { added, problems };
}

export const formatBytes = (n: number) => (n < 1024 ? `${n} B` : `${formatNumber(n / 1024, n < 10 * 1024 ? 1 : 0)} kB`);

const plural = (n: number, one: string, many = `${one}s`) => `${formatNumber(n, 0)} ${n === 1 ? one : many}`;
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const clip = (s: string, n = 100) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function splitRow(line: string, sep: string) {
  return line.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, "$1"));
}

/** A delimited table: its size, its columns and the range of each numeric column. */
function describeTable(text: string, sep: string) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return "It has no rows below its header.";
  const head = splitRow(lines[0], sep);
  const rows = lines.slice(1).map((l) => splitRow(l, sep));
  let out = `It is a table of ${plural(rows.length, "row")} and ${plural(head.length, "column")}: ${list(head.map((h) => h || "(unnamed)"))}.`;
  const numeric = head
    .map((name, i) => {
      const cells = rows.map((r) => r[i]).filter((c) => c !== undefined && c !== "");
      const values = cells.map(Number).filter((v) => Number.isFinite(v));
      return { name, values, numeric: cells.length > 0 && values.length >= 0.8 * cells.length };
    })
    .filter((c) => c.numeric && c.name);
  const ranges = numeric.slice(0, 4).map(({ name, values }) => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const d = Math.abs(max - min) < 10 ? 2 : Math.abs(max) < 1000 ? 1 : 0;
    return `${name} from ${formatNumber(min, d)} to ${formatNumber(max, d)} (mean ${formatNumber(mean, d)})`;
  });
  if (ranges.length) out += ` Numeric columns: ${ranges.join("; ")}${numeric.length > ranges.length ? `; ${numeric.length - ranges.length} more` : ""}.`;
  const short = rows.filter((r) => r.length !== head.length).length;
  if (short) out += ` ${plural(short, "row")} ${short === 1 ? "has" : "have"} a different number of cells from the header.`;
  return out;
}

function describeJson(text: string) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return `It is not valid JSON (${e instanceof Error ? e.message : "parse error"}).`;
  }
  const keys = (o: unknown) => (o && typeof o === "object" && !Array.isArray(o) ? Object.keys(o) : []);
  if (Array.isArray(value)) {
    const k = keys(value[0]);
    return `It is a JSON array of ${plural(value.length, "item")}${k.length ? `; the first has the keys ${list(k.slice(0, 8))}${k.length > 8 ? " and more" : ""}` : ""}.`;
  }
  const k = keys(value);
  return k.length ? `It is a JSON object with ${plural(k.length, "key")}: ${list(k.slice(0, 8))}${k.length > 8 ? " and more" : ""}.` : `It is a JSON ${value === null ? "null" : typeof value} value.`;
}

function describeText(text: string, name: string) {
  const lines = text.split(/\r?\n/);
  const words = text.split(/\s+/).filter(Boolean).length;
  let out = `It has ${plural(lines.filter((l) => l.trim()).length, "line")} of text and ${plural(words, "word")}.`;
  const headings = lines.filter((l) => /^#{1,3}\s+\S/.test(l)).map((l) => l.replace(/^#+\s+/, "").trim());
  if (extensionOf(name) === ".md" && headings.length) out += ` Its headings: ${list(headings.slice(0, 4).map((h) => clip(h, 60)))}${headings.length > 4 ? " and more" : ""}.`;
  const flagged = lines.filter((l) => /\b(error|fail\w*|fault\w*|alarm\w*|trip\w*|warn\w*)\b/i.test(l));
  if (flagged.length) out += ` ${plural(flagged.length, "line")} mention${flagged.length === 1 ? "s" : ""} an error, fault, alarm, trip or warning; the first reads “${clip(flagged[0].trim())}”.`;
  return out;
}

/** What one attached file contains, in plain sentences computed from its text. */
export function describeAttachment(a: AttachmentInput, vocab: Vocabulary) {
  const ext = extensionOf(a.name);
  let text = `${a.name} (${formatBytes(a.size)}): `;
  if (!a.text.trim()) return `${text}it is empty.`;
  text += ext === ".csv" ? describeTable(a.text, ",") : ext === ".tsv" ? describeTable(a.text, "\t") : ext === ".json" ? describeJson(a.text) : describeText(a.text, a.name);
  const named = mentions(a.text, vocab);
  const names = [
    ...named.equipment.map((id) => vocab.devices.find((d) => d.id === id)?.label ?? id),
    ...named.metrics.map((k) => vocab.metrics.find((m) => m.key === k)?.label ?? k),
  ];
  if (names.length) text += ` It names ${list(names.slice(0, 6))}${names.length > 6 ? " and more" : ""}.`;
  return text;
}
