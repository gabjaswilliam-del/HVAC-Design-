import { beforeEach, describe, expect, it } from "vitest";
import { getOperating, operating } from "./operatingContext";

describe("the live simulation and the replay never run together", () => {
  beforeEach(() => {
    operating.setPilotRunning(false);
    operating.setPlaying(false);
    operating.setMode("live");
  });

  it("opens on the live demo, paused, at 60x", () => {
    expect(getOperating()).toMatchObject({ mode: "live", playing: false, speed: 60 });
  });

  it("refuses to change source while one runs, and changes it while paused", () => {
    operating.setPlaying(true);
    operating.setMode("replay");
    expect(getOperating()).toMatchObject({ mode: "live", playing: true });
    operating.setPlaying(false);
    operating.setMode("replay");
    expect(getOperating()).toMatchObject({ mode: "replay", playing: false });
  });

  it("does not start the simulation over a playing replay, and starts it from a paused one", () => {
    operating.setMode("replay");
    operating.setPlaying(true);
    expect(operating.runSimulation()).toBe(false);
    expect(getOperating()).toMatchObject({ mode: "replay", playing: true });
    operating.setPlaying(false);
    expect(operating.runSimulation()).toBe(true);
    expect(getOperating()).toMatchObject({ mode: "live", playing: true });
  });

  it("keeps the replay waiting while an AI Pilot run plays, though the deck is paused", () => {
    operating.setPilotRunning(true);
    operating.setMode("replay");
    expect(getOperating().mode).toBe("live");
    operating.setPilotRunning(false);
    operating.setMode("replay");
    operating.setPilotRunning(true);
    operating.setPlaying(true);
    expect(getOperating()).toMatchObject({ mode: "replay", playing: false });
  });

  it("pauses a playing replay when an AI Pilot run starts elsewhere", () => {
    operating.setMode("replay");
    operating.setPlaying(true);
    operating.setPilotRunning(true);
    expect(getOperating()).toMatchObject({ mode: "replay", playing: false, pilotRunning: true });
  });

  it("moves the clock at the chosen speed in either source", () => {
    const from = getOperating().cursor;
    operating.setSpeed(300);
    operating.setPlaying(true);
    operating.tick(1000);
    expect(getOperating().cursor - from).toBe(300_000);
  });
});
