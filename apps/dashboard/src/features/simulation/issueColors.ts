// A distinct colour for each of a run's pilot issues, stable within the run (by the
// issue's position in the pilot's list): the replay marks every open issue's period on
// the scrubber and the trend charts in its own colour, and AI Pilot's unresolved list
// repeats the same colour, so the marks can be told apart at a glance.

/** Hues chosen distinct on the dark theme and apart from the chart series colours. */
const PALETTE = ["#e8b23a", "#5aa9e6", "#7fc8a9", "#e07a5f", "#b18be8", "#e86aa7", "#66c2d1", "#d4e157"];

/** The issue's colour: its index in the run's issue list, cycling the palette. */
export function issueColor(issueId: string, issues: readonly { id: string }[]): string {
  const i = issues.findIndex((x) => x.id === issueId);
  return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
}
