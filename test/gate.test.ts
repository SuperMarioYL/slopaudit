import { describe, it, expect } from "vitest";
import {
  resolveThreshold,
  gateTrips,
  InvalidThresholdError,
} from "../src/gate/threshold.js";
import type { SlopScore } from "../src/types.js";

function scoreOf(n: number): SlopScore {
  const band = n < 34 ? "clean" : n <= 66 ? "moderate" : "heavy";
  return { score: n, band, findings: [], byFile: {}, filesScanned: 1, linesScanned: 1 };
}

describe("resolveThreshold()", () => {
  it("maps band names to their lower-bound ceiling", () => {
    expect(resolveThreshold("clean")).toBe(0);
    expect(resolveThreshold("moderate")).toBe(34);
    expect(resolveThreshold("heavy")).toBe(67);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(resolveThreshold("  Heavy ")).toBe(67);
    expect(resolveThreshold("MODERATE")).toBe(34);
  });

  it("accepts integer thresholds in 0..100", () => {
    expect(resolveThreshold("0")).toBe(0);
    expect(resolveThreshold("50")).toBe(50);
    expect(resolveThreshold("100")).toBe(100);
  });

  it("rejects non-integers, out-of-range, and garbage", () => {
    for (const bad of ["", "  ", "12.5", "-1", "101", "1e2", "0x10", "abc", "heav"]) {
      expect(() => resolveThreshold(bad)).toThrow(InvalidThresholdError);
    }
  });
});

describe("gateTrips()", () => {
  it("--fail-on moderate trips on moderate and heavy, not clean", () => {
    expect(gateTrips(scoreOf(10), "moderate")).toBe(false); // clean
    expect(gateTrips(scoreOf(34), "moderate")).toBe(true); // exactly moderate floor
    expect(gateTrips(scoreOf(50), "moderate")).toBe(true);
    expect(gateTrips(scoreOf(80), "moderate")).toBe(true); // heavy
  });

  it("--fail-on heavy trips only on heavy", () => {
    expect(gateTrips(scoreOf(50), "heavy")).toBe(false); // moderate
    expect(gateTrips(scoreOf(66), "heavy")).toBe(false); // top of moderate
    expect(gateTrips(scoreOf(67), "heavy")).toBe(true); // heavy floor
    expect(gateTrips(scoreOf(90), "heavy")).toBe(true);
  });

  it("--fail-on clean trips on any non-negative score (ceiling 0)", () => {
    expect(gateTrips(scoreOf(0), "clean")).toBe(true);
    expect(gateTrips(scoreOf(20), "clean")).toBe(true);
  });

  it("numeric thresholds gate on score >= ceiling", () => {
    expect(gateTrips(scoreOf(79), "80")).toBe(false);
    expect(gateTrips(scoreOf(80), "80")).toBe(true);
    expect(gateTrips(scoreOf(81), "80")).toBe(true);
  });

  it("propagates InvalidThresholdError for a bad threshold", () => {
    expect(() => gateTrips(scoreOf(50), "nope")).toThrow(InvalidThresholdError);
  });
});
