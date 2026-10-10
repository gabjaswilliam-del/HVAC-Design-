import { describe, expect, it } from "vitest";
import { createFixtureClient } from "../../fixtures/fixtureClient";
import { focusOf, vocabularyOf } from "../../fixtures/agentScripts";
import { focusAfter, mentions, rangeIn, understand, normalize, type Focus, type Intent } from "./understand";

const vocab = vocabularyOf(await createFixtureClient("normal", { latencyMs: 0 }).getSite());
const read = (text: string, attachments = 0, focus: Focus = {}) => understand(text, vocab, { attachments, focus });
const today = { kind: "today" } as const;

/** Each intent with the ways people ask for it. */
const CASES: [Intent, string[]][] = [
  [
    { kind: "metric_trend", key: "plant:cop", range: today },
    [
      "Show me COP",
      "Show me COP today.",
      "How has COP been today?",
      "how is our COP doing?",
      "let me see COP performance",
      "COP trend",
      "plot the coefficient of performance",
      "can you pull up cop",
      "How has COP changed today?",
      "How has COP been?",
    ],
  ],
  [{ kind: "metric_trend", key: "plant:cop", range: { kind: "last_hours", hours: 6 } }, ["COP over the last 6 hours", "how was cop in the past six hours"]],
  [{ kind: "metric_value", key: "plant:cop" }, ["What's the COP?", "what is the cop now", "current COP"]],
  [{ kind: "metric_trend", key: "plant:power_kw", range: today }, ["show plant power", "graph the electricity consumption today"]],
  [{ kind: "metric_trend", key: "chw_supply:temp_c", range: today }, ["show the chilled water supply temperature"]],
  [{ kind: "metric_trend", key: "plant:unmet_kw", range: today }, ["show unmet demand"]],
  [{ kind: "metric_trend", key: "plant:cop", range: { kind: "beyond", said: "yesterday" } }, ["What was COP yesterday?"]],
  [{ kind: "equipment_open", id: "chiller_plant_2" }, ["open Chiller 2", "show me chiller 2", "bring up CH-2", "Chiller 2 details"]],
  [{ kind: "equipment_investigate", id: "chiller_plant_2" }, ["What is happening with Chiller 2?", "Investigate Chiller 2", "what's wrong with chiller #2?", "is ch2 ok"]],
  [{ kind: "equipment_history", id: "chiller_plant_2", range: today }, ["Chiller 2 history", "show me chiller 2's history", "how has chiller 2 been today"]],
  [{ kind: "equipment_investigate", id: "cooling_water_pump_2" }, ["why is cw pump 2 off", "Investigate condenser pump 2"]],
  [{ kind: "equipment_investigate", id: "chilled_water_pump_pri_2" }, ["Investigate CHW pump 2"]],
  [{ kind: "equipment_investigate", id: "cooling_towers_4" }, ["Investigate Cooling tower 4", "tower 4?"]],
  [{ kind: "attention" }, ["What needs attention right now?", "anything wrong?", "are there any alarms", "any problems"]],
  [{ kind: "fault_history", range: today }, ["what went wrong today?", "any faults since this morning"]],
  [{ kind: "fault_history", range: { kind: "last_hours", hours: 24 } }, ["Was anything broken in the last 24 hours?", "any failures in the past 24 hours"]],
  [{ kind: "fault_history", range: { kind: "last_hours", hours: 6 } }, ["alarms in the last 6 hours"]],
  [{ kind: "shortfall" }, ["Is the plant meeting cooling demand?", "are we keeping up with the load", "is there enough cooling", "any unmet demand?"]],
  [{ kind: "forecast" }, ["What cooling demand is forecast for the next 6 hours?", "forecast", "what load do we expect tonight", "predict demand"]],
  [{ kind: "efficiency" }, ["How efficient is the plant right now?", "is the plant running efficiently"]],
  [{ kind: "simulation_history" }, ["tell me our simulation history", "what simulations have we run?", "list the runs", "past simulations", "show me the simulation history", "show me the last simulations"]],
  [{ kind: "run_summary", runId: "RUN-0008" }, ["open RUN-0008", "how did RUN-0008 go", "summary of run 8", "run #8", "why did RUN-0008 stop?"]],
  [
    { kind: "run_summary", runId: null },
    ["How did the last simulation go?", "how did the latest run end?", "summarize the last simulation", "what was the outcome of the previous run", "Show me the last simulation.", "replay the latest run"],
  ],
  [{ kind: "current_simulation" }, ["show me the current simulation", "is a simulation running?", "what's the live run doing"]],
  [{ kind: "pilot_findings", runId: null }, ["What did the pilot find?", "show the AI pilot's findings", "any issues from the pilot", "what does the pilot say"]],
  [{ kind: "pilot_issue", issueId: "PIL-0001-2" }, ["inspect PIL-0001-2", "what is pil-1-2", "tell me about PIL-0001-2"]],
  [{ kind: "compare_runs", runIds: [] }, ["compare the latest two simulations", "Compare the latest two simulations.", "compare the last 2 runs", "how do the last two runs compare"]],
  [{ kind: "compare_runs", runIds: ["RUN-0007", "RUN-0008"] }, ["compare RUN-0007 with RUN-0008", "RUN-0007 vs RUN-0008", "difference between run 7 and run 8"]],
  [{ kind: "compare_runs", runIds: ["RUN-0008"] }, ["compare RUN-0008 with its matched run"]],
  [{ kind: "greeting" }, ["hello", "Good morning"]],
  [{ kind: "help" }, ["what can you do?", "help"]],
  [{ kind: "unknown" }, ["tell me a joke", "what's the weather in Paris tomorrow"]],
];

/** Requests to change something, with the control they name: pointed to, never pressed. */
const CONTROL: [Partial<Extract<Intent, { kind: "control" }>>, string[]][] = [
  [{ target: "simulation", control: "stop", runId: null }, ["stop the simulation", "I want you to stop the run", "please stop it now"]],
  [{ target: "simulation", control: "stop", runId: "RUN-0003" }, ["stop RUN-0003", "Can you stop run 3?"]],
  [{ target: "simulation", control: "pause", runId: "RUN-0003" }, ["Can you pause RUN-0003?"]],
  [{ target: "simulation", control: "start" }, ["please start a new simulation", "run the heat wave scenario", "let's restart the sim"]],
  [{ target: "simulation", control: "resume" }, ["resume", "continue the simulation"]],
  [{ target: "simulation", control: "step" }, ["step the run"]],
  [{ target: "simulation", control: "monitoring" }, ["pause monitoring"]],
  [{ target: "proposal", issueId: "PIL-0003-1" }, ["apply PIL-0003-1"]],
  [{ target: "proposal", issueId: null }, ["apply the pilot's proposal", "accept the recommendation"]],
  [{ target: "setpoint" }, ["set chiller 1 setpoint to 9", "raise the chilled water temperature on chiller 2", "we need to lower the tower fan speed"]],
  [{ target: "override" }, ["release the override", "please release all overrides"]],
  [{ target: "equipment" }, ["turn off CW pump 2", "start chiller 3", "shut down tower 4"]],
];

describe("offline understanding", () => {
  for (const [intent, phrasings] of CASES) {
    it(`reads ${JSON.stringify(intent)}`, () => {
      for (const p of phrasings) expect(read(p), p).toEqual(intent);
    });
  }

  for (const [frame, phrasings] of CONTROL) {
    it(`reads a request to change ${JSON.stringify(frame)}`, () => {
      for (const p of phrasings) expect(read(p), p).toMatchObject({ kind: "control", ...frame });
    });
  }

  it("never reads a question about a run's end, or a run ID, as control", () => {
    for (const p of ["when did the simulation end?", "did we run a simulation today", "RUN-0001 vs RUN-0002", "how long do the pumps run", "which run stopped first"]) {
      expect(read(p).kind, p).not.toBe("control");
    }
  });

  it("reads the time a request is about", () => {
    const r = (t: string) => rangeIn(normalize(t));
    expect(r("since midnight")).toEqual({ kind: "today" });
    expect(r("in the last hour")).toEqual({ kind: "last_hours", hours: 1 });
    expect(r("over the past 48 hours")).toEqual({ kind: "last_hours", hours: 24 }); // the demo holds one day
    expect(r("for the next six hours")).toEqual({ kind: "next_hours", hours: 6 });
    expect(r("last week")).toEqual({ kind: "beyond", said: "last week" });
    expect(r("right now")).toEqual({ kind: "now" });
    expect(r("the last simulation")).toBeNull(); // "last" alone is not a time
  });

  it("reads requests about attached files only when there are files", () => {
    expect(read("summarize this", 1)).toEqual({ kind: "attachments" });
    expect(read("", 2)).toEqual({ kind: "attachments" });
    expect(read("what's in it?", 1)).toEqual({ kind: "attachments" });
    expect(read("summarize this")).toEqual({ kind: "unknown" });
    // A question about the plant stays one, with or without a file.
    expect(read("Is the plant meeting cooling demand?", 1)).toEqual({ kind: "shortfall" });
  });

  it("finds the equipment and indicators a text names", () => {
    const named = mentions("Chiller 2 tripped; CT-4 fan at 0 Hz. COP fell, power_kw rose.", vocab);
    expect(named.equipment.sort()).toEqual(["chiller_plant_2", "cooling_towers_4"]);
    expect(named.metrics).toEqual(["plant:cop", "plant:power_kw"]);
  });
});

describe("follow-ups read against the conversation", () => {
  const after = (...prompts: string[]) => focusOf(prompts, vocab);

  it("carries an indicator's subject and period to a question without one", () => {
    const cop = after("Show me COP today.");
    expect(cop).toMatchObject({ subject: "metric", metric: "plant:cop", metricAs: "trend" });
    expect(read("What about the last 6 hours?", 0, cop)).toEqual({ kind: "metric_trend", key: "plant:cop", range: { kind: "last_hours", hours: 6 } });
    expect(read("And power?", 0, cop)).toEqual({ kind: "metric_trend", key: "plant:power_kw", range: today });
    expect(read("and now?", 0, cop)).toEqual({ kind: "metric_value", key: "plant:cop" });
    // A day the data does not hold is read, then answered honestly, never guessed.
    expect(read("How about yesterday?", 0, cop)).toEqual({ kind: "metric_trend", key: "plant:cop", range: { kind: "beyond", said: "yesterday" } });
    // After a value, "and power?" is a value too.
    expect(read("And power?", 0, after("What's the COP?"))).toEqual({ kind: "metric_value", key: "plant:power_kw" });
  });

  it("carries equipment to its pronoun", () => {
    const chiller = after("What is happening with Chiller 2?");
    expect(read("Show me its history.", 0, chiller)).toEqual({ kind: "equipment_history", id: "chiller_plant_2", range: today });
    expect(read("what's wrong with it?", 0, chiller)).toEqual({ kind: "equipment_investigate", id: "chiller_plant_2" });
    expect(read("open it", 0, chiller)).toEqual({ kind: "equipment_open", id: "chiller_plant_2" });
  });

  it("carries a run and an issue", () => {
    expect(read("compare it with the previous one", 0, after("open RUN-0002"))).toEqual({ kind: "compare_runs", runIds: ["RUN-0002"] });
    expect(read("show its evidence", 0, after("inspect PIL-0001-2"))).toEqual({ kind: "pilot_issue", issueId: "PIL-0001-2" });
  });

  it("says what it cannot resolve instead of guessing", () => {
    expect(read("Show me its history.")).toEqual({ kind: "unresolved", reference: "its" });
    expect(read("How about yesterday?")).toEqual({ kind: "unresolved", reference: "How about yesterday" });
    // A new subject replaces the old one: the follow-up leans on the newest.
    expect(read("Show me its history.", 0, after("What is happening with Chiller 2?", "Show me COP today"))).toEqual({ kind: "metric_trend", key: "plant:cop", range: today });
  });

  it("keeps the focus across turns that change nothing", () => {
    const f = focusAfter(after("Investigate Cooling tower 4"), { kind: "thanks" });
    expect(f).toMatchObject({ subject: "equipment", equipment: "cooling_towers_4" });
    expect(focusAfter(f, { kind: "attention" })).toEqual({});
  });
});
