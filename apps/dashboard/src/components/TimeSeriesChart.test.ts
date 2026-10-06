import { describe, expect, it } from "vitest";
import { stepDecimals } from "./TimeSeriesChart";

describe("axis tick decimals", () => {
  it("prints every nice step exactly, so neighbouring ticks never share a label", () => {
    expect([1, 2, 5, 10, 250, 2000].map(stepDecimals)).toEqual([0, 0, 0, 0, 0, 0]);
    expect([2.5, 0.1, 0.2, 0.5].map(stepDecimals)).toEqual([1, 1, 1, 1]);
    expect([0.05, 0.25, 0.01].map(stepDecimals)).toEqual([2, 2, 2]);
    expect(stepDecimals(0.025)).toBe(3);
  });
});
