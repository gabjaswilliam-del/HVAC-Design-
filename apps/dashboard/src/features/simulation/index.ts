// Public entry point of the simulation feature: Simulation history, and the run views
// AI Pilot reuses for a live run.
export { HistoryPage } from "./HistoryPage";
export { RunStateLabel, CorrectionStatusLabel, OutcomeText, Loading } from "./labels";
export { session as simulationSession, useSimulation, usePilotRunning, liveRunOf, type PilotView, type PilotControl } from "./simulationSession";
export { SimulatedPlant } from "./SimulatedPlant";
export { RunControls, hm } from "./RunControls";
export { ScenarioForm } from "./ScenarioForm";
export { CorrectionHistory } from "./CorrectionHistory";
export { SimulationTimeline } from "./SimulationTimeline";
export { ResultsView, Chart } from "./ResultsView";
export { RunSummaryView } from "./RunSummaryView";
