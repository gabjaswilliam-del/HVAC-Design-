/** Plant-level helpers over reported data, shared by screens and the agent harness. */
import type { History } from "./contracts";

/** Contiguous periods in which the reported unmet demand was above zero. */
export function shortfallPeriods(history: History | undefined) {
  const unmet = history?.series.find((x) => x.metric === "plant:unmet_kw");
  if (!history || !unmet) return [];
  const periods: { from: string; to: string; peak: number; ongoing: boolean }[] = [];
  unmet.values.forEach((v, i) => {
    const t = history.times[i];
    const last = periods.at(-1);
    if (v !== null && v > 0) {
      if (last && last.ongoing) (last.to = t), (last.peak = Math.max(last.peak, v));
      else periods.push({ from: t, to: t, peak: v, ongoing: true });
    } else if (last) last.ongoing = false;
  });
  return periods;
}
