/**
 * The pilot's run summary, built only from what the run and the pilot recorded: results,
 * corrections and their outcomes, run events, issues and their evidence. Deterministic:
 * the same records give the same summary. No sentence states anything the records do not
 * show, and no language model is involved.
 */
import { formatNumber, formatTime } from "../lib/format";
import type { PilotState, RunDetail, RunSummary } from "../lib/contracts/simulation";

type Pilot = Pick<PilotState, "issues" | "scans">;
type Line = RunSummary["timeline"][number];

const nums = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null);
const fmt = (v: number | null, d: number) => (v === null ? "unavailable" : formatNumber(v, d));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** COP within this of where it started counts as unchanged. */
const COP_STEADY = 0.05;

export function summarizeRun(run: RunDetail, pilot: Pilot | null, generatedAt: string, timeZone: string): RunSummary {
  const t = (iso: string) => formatTime(iso, timeZone);
  const r = run.results;
  const cops = nums(r.cop);
  const unmet = nums(r.unmetKw);
  const demand = nums(r.demandKw);
  const firstCop = r.cop.find((v) => v !== null) ?? null;
  const lastCop = [...r.cop].reverse().find((v) => v !== null) ?? null;
  const startedAt = r.times[0] ?? null;
  const endedAt = r.times.at(-1) ?? null;
  const endReason = run.state === "failed" ? "failed" : run.stepsTaken >= run.stepsTotal ? "completed" : "stopped";
  const issues = pilot?.issues ?? [];
  const monitored = (pilot?.scans ?? 0) > 0;
  const label = (c: RunDetail["corrections"][number]) => `${c.id} (${c.kind === "release" ? `release ${c.label.toLowerCase()}` : `${c.label.toLowerCase()} ${c.value} ${c.unit}`})`;

  const corrections = {
    operator: run.corrections.filter((c) => c.origin.kind === "operator").length,
    pilot: run.corrections.filter((c) => c.origin.kind === "pilot").length,
    applied: run.corrections.filter((c) => c.status === "applied").length,
    rejected: run.corrections.filter((c) => c.status === "rejected").length,
    superseded: run.corrections.filter((c) => c.status === "superseded").length,
    expired: run.corrections.filter((c) => c.status === "expired").length,
    reached: run.corrections.filter((c) => c.outcome?.reached).length,
    notReached: run.corrections.filter((c) => c.outcome && !c.outcome.reached).length,
  };

  // The important moments, in simulated time.
  const timeline: Line[] = [];
  for (const e of run.events) {
    if (e.kind === "failure") timeline.push({ at: e.at, kind: "failure", text: e.text });
    else if (e.kind === "lifecycle" && /started|Stopped by|completed/.test(e.text)) timeline.push({ at: e.at, kind: "lifecycle", text: e.text });
  }
  for (const i of issues) {
    timeline.push({ at: i.firstSeen, kind: "detection", text: `${i.id} detected: ${i.title}.`, issueId: i.id });
    const reasoning = i.evidence.find((e) => e.kind === "reasoning" && e.status !== "error");
    if (reasoning) timeline.push({ at: reasoning.at, kind: "investigation", text: `${i.id} investigated: ${reasoning.text}`, issueId: i.id });
    const proposal = i.evidence.find((e) => e.kind === "proposal");
    if (proposal) timeline.push({ at: proposal.at, kind: "proposal", text: proposal.text, issueId: i.id });
    const decision = i.evidence.find((e) => e.kind === "decision");
    if (decision) timeline.push({ at: decision.at, kind: "decision", text: `${i.id}: ${decision.text}`, issueId: i.id });
    if (i.resolution) timeline.push({ at: i.resolution.at, kind: "resolution", text: `${i.id} resolved. ${i.resolution.summary}`, issueId: i.id });
  }
  for (const c of run.corrections) {
    const who = c.origin.kind === "pilot" ? `Operator applied ${c.origin.issueId}'s proposal` : "Operator correction";
    if (c.status === "rejected") timeline.push({ at: c.submittedAt, kind: "operator", text: `${who} ${label(c)} rejected: ${c.rejection?.reason}`, correctionId: c.id });
    else timeline.push({ at: c.submittedAt, kind: "operator", text: `${who} ${label(c)} submitted.`, correctionId: c.id });
    if (c.applied) timeline.push({ at: c.applied.at, kind: "operator", text: `${c.id} applied at step ${c.applied.step}.`, correctionId: c.id });
    if (c.outcome) timeline.push({ at: c.outcome.observedAt, kind: "outcome", text: `${c.id}: ${c.outcome.note}`, correctionId: c.id });
  }
  timeline.sort((a, b) => a.at.localeCompare(b.at));

  const assessment: RunSummary["assessment"] = [];
  const recommendations: RunSummary["recommendations"] = [];
  const planned = Math.round(run.config.durationHours * 60);
  const ended = { completed: "completed", stopped: "was stopped by the operator", failed: "failed" }[endReason];
  assessment.push({
    kind: "observation",
    text: `The run ${ended} after ${run.stats.simulatedMinutes} of ${planned} simulated minutes${startedAt && endedAt ? `, ${t(startedAt)} to ${t(endedAt)}` : ""}.`,
  });
  if (cops.length) {
    assessment.push({
      kind: "observation",
      text: `Average COP ${fmt(run.stats.avgCop, 2)}; ${formatNumber(run.stats.energyKwh, 0)} kWh of electrical energy for an average demand of ${fmt(run.stats.avgDemandKw, 0)} kWt.`,
    });
  }
  if (firstCop !== null && lastCop !== null && cops.length > 1) {
    const change = lastCop - firstCop;
    const span = `${fmt(firstCop, 2)} at ${t(startedAt!)} to ${fmt(lastCop, 2)} at ${t(endedAt!)}`;
    if (change > COP_STEADY) assessment.push({ kind: "improved", text: `COP rose from ${span}.` });
    else if (change < -COP_STEADY) assessment.push({ kind: "not_improved", text: `COP fell from ${span}.` });
    else assessment.push({ kind: "observation", text: `COP held steady, ${span}.` });
  }
  if (run.stats.unmetKwh > 0) {
    assessment.push({
      kind: "concern",
      text: `Cooling demand was not fully met in ${unmet.filter((v) => v > 0).length} of ${unmet.length} observations (peak ${formatNumber(run.stats.peakUnmetKw, 0)} kWt, ${formatNumber(run.stats.unmetKwh, 0)} kWh unmet).`,
    });
    recommendations.push({ text: "Check running chiller capacity during the unmet periods; staging another chiller is the baseline controller's decision, not a correction.", basis: "Unmet demand recorded in the run's results." });
  } else if (unmet.length) assessment.push({ kind: "observation", text: "Cooling demand was met throughout." });
  for (const c of run.corrections.filter((x) => x.outcome)) {
    assessment.push({ kind: c.outcome!.reached ? "improved" : "not_improved", text: `${label(c)}: ${c.outcome!.note}` });
  }
  if (corrections.rejected) {
    const reasons = [...new Set(run.corrections.filter((c) => c.rejection).map((c) => c.rejection!.code.replace("_", " ")))].join(", ");
    assessment.push({ kind: "observation", text: `${plural(corrections.rejected, "correction was", "corrections were")} rejected by the run's gate (${reasons}).` });
  }
  if (run.state === "failed" && run.lastError) {
    assessment.push({ kind: "concern", text: `The run failed: ${run.lastError}${endedAt ? ` Results end at the last valid observation, ${t(endedAt)}.` : ""}` });
    if (/envelope/i.test(run.lastError)) {
      recommendations.push({ text: "Repeat the scenario within the model's envelope, with an earlier start or a shorter duration.", basis: "The run left the calibrated envelope." });
    }
  }
  if (!monitored) {
    assessment.push({ kind: "observation", text: "The pilot did not monitor this run, so no issues were screened." });
    recommendations.push({ text: "Run the scenario again from AI Pilot so the pilot screens it.", basis: "No pilot scans were recorded." });
  }
  const unresolved = issues.filter((i) => i.open);
  if (unresolved.length) {
    assessment.push({ kind: "concern", text: `${plural(unresolved.length, "pilot issue remains", "pilot issues remain")} unresolved: ${unresolved.map((i) => `${i.id} (${i.title})`).join("; ")}.` });
  }
  for (const i of unresolved) {
    const applied = i.correctionIds.some((id) => run.corrections.find((c) => c.id === id)?.status === "applied");
    if (i.proposal && i.declinedAt) {
      recommendations.push({
        text: `${i.id}'s proposal (${i.proposal.label.toLowerCase()} ${i.proposal.value} ${i.proposal.unit}) was declined and the condition remained. If its effect is still of interest, try it in a matched run and compare.`,
        basis: `${i.id}: the operator declined the proposal; nothing was applied.`,
      });
    } else if (i.proposal && !applied) {
      recommendations.push({
        text: `Apply ${i.id}'s proposal (${i.proposal.label.toLowerCase()} ${i.proposal.value} ${i.proposal.unit}) in a matched run and compare its energy and COP with this one.`,
        basis: `${i.id}: a proposal was recorded and never applied.`,
      });
    } else if (i.advisory) {
      recommendations.push({ text: `Review ${i.id} (${i.title}). ${i.advisory}`, basis: `${i.id} is open without a correction.` });
    }
  }
  if (corrections.reached) {
    recommendations.push({
      text: "Compare this run with a matched run without the corrections to measure their effect on energy and COP.",
      basis: `${plural(corrections.reached, "correction", "corrections")} reached ${corrections.reached === 1 ? "its" : "their"} setpoint.`,
    });
  }
  if (!recommendations.length) recommendations.push({ text: "Nothing in the recorded run calls for a follow-up.", basis: "No unresolved issues, unmet demand or failures were recorded." });

  return {
    schemaVersion: 1,
    runId: run.runId,
    basis: "recorded",
    generatedAt,
    identity: {
      name: run.name,
      scenario: run.scenario,
      configRevision: run.configRevision,
      state: run.state,
      endReason,
      startedAt,
      endedAt,
      simulatedMinutes: run.stats.simulatedMinutes,
      plannedMinutes: planned,
      lastError: run.lastError,
    },
    performance: {
      avgCop: run.stats.avgCop,
      firstCop,
      lastCop,
      energyKwh: run.stats.energyKwh,
      avgPowerKw: run.stats.avgPowerKw,
      avgDemandKw: run.stats.avgDemandKw,
      peakDemandKw: demand.length ? Math.max(...demand) : null,
      peakUnmetKw: run.stats.peakUnmetKw,
      unmetKwh: run.stats.unmetKwh,
      unmetSteps: unmet.filter((v) => v > 0).length,
      steps: r.times.length,
    },
    pilot: {
      monitored,
      issues: issues.length,
      resolved: issues.filter((i) => !i.open).length,
      investigations: issues.filter((i) => i.evidence.some((e) => e.kind === "reasoning" && e.status !== "error")).length,
      proposals: issues.filter((i) => i.evidence.some((e) => e.kind === "proposal")).length,
      declined: issues.filter((i) => i.evidence.some((e) => e.kind === "decision")).length,
      unresolved: unresolved.map((i) => ({ issueId: i.id, title: i.title, severity: i.severity, stage: i.stage })),
    },
    corrections,
    timeline,
    assessment,
    recommendations,
  };
}
