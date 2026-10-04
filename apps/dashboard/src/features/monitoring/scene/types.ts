import type { Snapshot } from "../../../lib/contracts";

export type { EquipmentStatus, Reading, SceneLayout } from "../../../lib/contracts";

/** What the scene needs from a snapshot: equipment states and readings by key. */
export type SceneReadings = Pick<Snapshot, "equipment" | "values">;
