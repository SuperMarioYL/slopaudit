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
    // clean's ceiling is 1 (not 0) so a pristine 0/100 passes `--fail-on clean`
    // — see fix-fail-on-clean-zero-always-trips.
    expect(resolveThreshold("clean")).toBe(1);
    expect(resolveThreshold("moderate")).toBe(34);
    expect(resolveThreshold("heavy")).toBe(67);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(resolveThreshold("  Heavy ")).toBe(67);
    expect(resolveThreshold("MODERATE")).toBe(34);
  });

  it("accepts integer thresholds in 0..100", () => {
    // numeric 0 means "fail on any slop" (ceiling 1) so a literal 0/100 passes.
    expect(resolveThreshold("0")).toBe(1);
    expect(resolveThreshold("1")).toBe(1);
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

  it("--fail-on clean trips on any slop but PASSES a pristine 0/100 (ceiling 1)", () => {
    // fix-fail-on-clean-zero-always-trips: a flawless 0/100 repo must pass.
    expect(gateTrips(scoreOf(0), "clean")).toBe(false);
    expect(gateTrips(scoreOf(1), "clean")).toBe(true);
    expect(gateTrips(scoreOf(20), "clean")).toBe(true);
  });

  it("--fail-on 0 means 'fail on any slop' and PASSES a pristine 0/100", () => {
    // numeric 0 mirrors the clean band: 0 itself passes, any slop trips.
    expect(gateTrips(scoreOf(0), "0")).toBe(false);
    expect(gateTrips(scoreOf(1), "0")).toBe(true);
    expect(gateTrips(scoreOf(50), "0")).toBe(true);
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
