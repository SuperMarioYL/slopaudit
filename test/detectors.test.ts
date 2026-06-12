import { describe, it, expect } from "vitest";
import { parseFile } from "../src/scan/parse.js";
import type { FileUnit } from "../src/scan/parse.js";
import { detectOverAbstraction } from "../src/detectors/overAbstraction.js";
import { detectGenericBoilerplate } from "../src/detectors/genericBoilerplate.js";
import { detectPlausibleButWrong } from "../src/detectors/plausibleButWrong.js";

/** Build a FileUnit from an inline code string, the same shape cli.ts produces. */
function unit(code: string, file = "fixture.ts"): FileUnit {
  const { ast, lineCount } = parseFile(file, code);
  return { file, code, lineCount, ast };
}

const CLEAN = `
export function add(a: number, b: number): number {
  return a + b;
}

export function describe(name: string): string {
  return "hello " + name;
}

export class Point {
  constructor(public x: number, public y: number) {}
  distanceTo(other: Point): number {
    const dx = this.x - other.x;
    const dy = this.y - other.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
}
`;

describe("detectOverAbstraction", () => {
  it("fires on a deep single-caller pass-through wrapper chain", () => {
    const slop = `
const four = (x: number) => leafImpl(x);
const three = (x: number) => four(x);
const two = (x: number) => three(x);
const one = (x: number) => two(x);
function leafImpl(x: number): number { return x + 1; }
`;
    const findings = detectOverAbstraction(unit(slop));
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.category === "over_abstraction")).toBe(true);
    // at least one wrapper-chain finding
    expect(findings.some((f) => /wrapper chain|pass-through/.test(f.evidence))).toBe(true);
  });

  it("returns [] on clean code", () => {
    expect(detectOverAbstraction(unit(CLEAN))).toEqual([]);
  });
});

describe("detectGenericBoilerplate", () => {
  it("fires on repeated try/catch scaffolding plus trivial getters", () => {
    const slop = `
class Bag {
  private _a = 1;
  private _b = 2;
  private _c = 3;
  private _d = 4;
  get a() { return this._a; }
  get b() { return this._b; }
  get c() { return this._c; }
  get d() { return this._d; }
}

function r1() {
  try { doThing(); } catch (e) { log(e); return null; }
}
function r2() {
  try { doThing(); } catch (e) { log(e); return null; }
}
function r3() {
  try { doThing(); } catch (e) { log(e); return null; }
}
`;
    const findings = detectGenericBoilerplate(unit(slop));
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.category === "generic_boilerplate")).toBe(true);
    expect(findings.some((f) => /getters|setters/.test(f.evidence))).toBe(true);
    expect(findings.some((f) => /try\/catch/.test(f.evidence))).toBe(true);
  });

  it("returns [] on clean code", () => {
    expect(detectGenericBoilerplate(unit(CLEAN))).toEqual([]);
  });
});

describe("detectPlausibleButWrong", () => {
  it("fires on empty catch + unawaited promise + any-heavy signature", () => {
    const slop = `
async function broken(a: any, b: any): any {
  try {
    fetchData(a);
  } catch (e) {
  }
}
`;
    const findings = detectPlausibleButWrong(unit(slop));
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.category === "plausible_but_wrong")).toBe(true);
    expect(findings.some((f) => /empty catch/.test(f.evidence))).toBe(true);
    expect(findings.some((f) => /any/.test(f.evidence))).toBe(true);
    expect(findings.some((f) => /not awaited|promise/.test(f.evidence))).toBe(true);
  });

  it("returns [] on clean code", () => {
    expect(detectPlausibleButWrong(unit(CLEAN))).toEqual([]);
  });
});
