/**
 * How Graph Memory's six kinds of record look, wherever they appear (the timeline, its
 * filters and legend, the search's choices, the record panel): an icon and a word always,
 * and a colour as well. The colours are data categories, like chart series, checked on the
 * timeline's space (#13161B to #191E24) with every pair side by side: each at least 3.6:1,
 * worst separation ΔE 38.7 in normal vision and 12.9 or more in simulated protanopia,
 * deuteranopia and tritanopia, none near the alarm red, the warning orange or the notice blue
 * that marks simulation. The icon and the word tell kinds apart without the colour. The icons
 * are compact shapes that stay recognisable small, on a sphere in the 3D view (an event's bolt
 * replaced a pulse line, which read as a squiggle there).
 */
import { Eye, Flag, Gavel, ScanSearch, Wrench, Zap, type LucideIcon } from "lucide-react";
import { useKnowledgeStrings } from "../../../lib/i18n/knowledge";
import type { MemoryKind, Provenance } from "../../../lib/contracts/memory";

export const KIND_ICONS: Record<MemoryKind, LucideIcon> = {
  event: Zap,
  observation: Eye,
  finding: ScanSearch,
  decision: Gavel,
  correction: Wrench,
  outcome: Flag,
};

export const KIND_COLOURS: Record<MemoryKind, string> = {
  event: "#6c7684",
  observation: "#2db39b",
  finding: "#c99a2e",
  decision: "#8178f2",
  correction: "#d986c0",
  outcome: "#d6ccb8",
};

export function KindLabel({ kind }: { kind: MemoryKind }) {
  const s = useKnowledgeStrings().memory;
  const Icon = KIND_ICONS[kind];
  return (
    <span className="kn-kind">
      <Icon size={14} aria-hidden="true" style={{ color: KIND_COLOURS[kind] }} />
      {s.kinds[kind]}
    </span>
  );
}

export function ProvenanceTag({ provenance, runId }: { provenance: Provenance; runId?: string | null }) {
  const s = useKnowledgeStrings().memory.provenance;
  const tone = provenance === "simulation" ? " tag-chip--notice" : provenance === "demo" ? " tag-chip--demo" : "";
  return (
    <span className={`tag-chip${tone}`} title={s.explain[provenance]}>
      {s.labels[provenance]}
      {provenance === "simulation" && runId ? ` · ${runId}` : ""}
    </span>
  );
}
