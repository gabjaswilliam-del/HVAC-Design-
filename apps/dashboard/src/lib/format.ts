/** Display formatting. Times on the wire are UTC; the UI shows the site timezone. */
import type { MetricInfo, Reading } from "./contracts";

const timeFormats = new Map<string, Intl.DateTimeFormat>();
function timeFormat(timeZone: string, withDate: boolean) {
  const key = `${timeZone}|${withDate}`;
  if (!timeFormats.has(key)) {
    timeFormats.set(
      key,
      new Intl.DateTimeFormat("en-GB", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        ...(withDate ? { year: "numeric", month: "2-digit", day: "2-digit" } : {}),
      }),
    );
  }
  return timeFormats.get(key)!;
}

export const formatTime = (t: string | number, timeZone: string) => timeFormat(timeZone, false).format(new Date(t));

export function formatDateTime(t: string | number, timeZone: string) {
  const parts = Object.fromEntries(timeFormat(timeZone, true).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

const numberFormats = new Map<number, Intl.NumberFormat>();
export function formatNumber(v: number, decimals: number) {
  if (!numberFormats.has(decimals)) {
    numberFormats.set(decimals, new Intl.NumberFormat("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }));
  }
  return numberFormats.get(decimals)!.format(v);
}

/** "1,068 kWt", or null when there is no value (callers say "Unavailable"). */
export function formatReading(r: Reading | undefined, info: Pick<MetricInfo, "decimals" | "unit"> | undefined) {
  if (!r || r.value === null) return null;
  const n = formatNumber(r.value, info?.decimals ?? 1);
  return info?.unit ? `${n} ${info.unit}` : n;
}

export function formatAgeMinutes(fromIso: string | null, toMs: number) {
  if (!fromIso) return null;
  return Math.max(0, Math.round((toMs - Date.parse(fromIso)) / 60_000));
}

/** Milliseconds to add to a UTC instant to get the site's wall-clock time. */
export function tzOffsetMs(timeZone: string, t: number) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
      .formatToParts(new Date(t))
      .map((p) => [p.type, Number(p.value)]),
  );
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - Math.floor(t / 60_000) * 60_000;
}

/** Start of the site-local day containing `t`. */
export function siteDayStart(t: number, timeZone: string) {
  const offset = tzOffsetMs(timeZone, t);
  return Math.floor((t + offset) / 86_400_000) * 86_400_000 - offset;
}
