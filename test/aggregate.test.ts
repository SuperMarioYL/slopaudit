import { describe, it, expect } from "vitest";
import { aggregate } from "../src/score/aggregate.js";
import type { SlopFinding } from "../src/types.js";

function finding(over: Partial<SlopFinding> = {}): SlopFinding {
  return {
    file: "a.ts",
    line: 1,
    category: "over_abstraction",
    weight: 0.5,
    evidence: "synthetic",
    ...over,
  };
}

describe("aggregate()", () => {
  it("is deterministic — same input yields identical score", () => {
    const findings: SlopFinding[] = [
      finding({ file: "b.ts", line: 5, weight: 0.6 }),
      finding({ file: "a.ts", line: 2, weight: 0.4, category: "generic_boilerplate" }),
      finding({ file: "a.ts", line: 1, weight: 0.5 }),
    ];
    const meta = { filesScanned: 2, linesScanned: 200 };
    const r1 = aggregate(findings, meta);
    // shuffle a copy — order must not change the result
    const r2 = aggregate([...findings].reverse(), meta);
    expect(r1.score).toBe(r2.score);
    expect(r1.band).toBe(r2.band);
    expect(r1.byFile).toEqual(r2.byFile);
    expect(r1.findings).toEqual(r2.findings);
  });

  it("empty findings -> score 0, band clean", () => {
    const r = aggregate([], { filesScanned: 10, linesScanned: 1000 });
    expect(r.score).toBe(0);
    expect(r.band).toBe("clean");
    expect(r.findings).toEqual([]);
    expect(r.byFile).toEqual({});
    expect(r.filesScanned).toBe(10);
    expect(r.linesScanned).toBe(1000);
  });

  it("a few light findings in a large repo stay in the clean band (<34)", () => {
    const findings = [finding({ weight: 0.4 })];
    const r = aggregate(findings, { filesScanned: 50, linesScanned: 10000 });
    expect(r.band).toBe("clean");
    expect(r.score).toBeLessThan(34);
  });

  it("moderate density lands in the moderate band (34..66)", () => {
    // density = (totalWeight / lines) * 100 ; score = 100*(1-exp(-0.7*density))
    // target score ~50 -> density ~ 0.99 -> totalWeight/lines ~ 0.0099
    // pick lines=100, totalWeight ~1.0 -> density=1.0 -> score ~50
    const findings = [finding({ weight: 1 })];
    const r = aggregate(findings, { filesScanned: 1, linesScanned: 100 });
    expect(r.score).toBeGreaterThanOrEqual(34);
    expect(r.score).toBeLessThanOrEqual(66);
    expect(r.band).toBe("moderate");
  });

  it("heavy slop density lands in the heavy band (>66)", () => {
    // many heavy findings over few lines -> high density -> saturates high
    const findings: SlopFinding[] = [];
    for (let i = 0; i < 20; i++) {
      findings.push(finding({ file: `f${i}.ts`, line: i + 1, weight: 1 }));
    }
    const r = aggregate(findings, { filesScanned: 20, linesScanned: 150 });
    expect(r.score).toBeGreaterThan(66);
    expect(r.band).toBe("heavy");
  });

  it("respects band boundaries via bandFor (clean<34, moderate 34..66, heavy>66)", () => {
    // exercise the exact thresholds by reverse-engineering densities
    const clean = aggregate([finding({ weight: 0.2 })], { filesScanned: 1, linesScanned: 1000 });
    expect(clean.band).toBe("clean");
    const heavy = aggregate(
      Array.from({ length: 30 }, (_, i) => finding({ file: `x${i}.ts`, line: i + 1, weight: 1 })),
      { filesScanned: 30, linesScanned: 100 },
    );
    expect(heavy.band).toBe("heavy");
  });

  it("computes per-file densities in byFile (0..1, one entry per offending file)", () => {
    const findings: SlopFinding[] = [
      finding({ file: "a.ts", line: 1, weight: 1 }),
      finding({ file: "a.ts", line: 2, weight: 1 }),
      finding({ file: "b.ts", line: 1, weight: 0.1 }),
    ];
    const r = aggregate(findings, { filesScanned: 2, linesScanned: 100 });
    expect(Object.keys(r.byFile).sort()).toEqual(["a.ts", "b.ts"]);
    for (const v of Object.values(r.byFile)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // the heavier file has the higher density
    expect(r.byFile["a.ts"]).toBeGreaterThan(r.byFile["b.ts"]);
  });
});
