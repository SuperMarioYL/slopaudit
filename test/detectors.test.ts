import { describe, it, expect } from "vitest";
import { parseFile } from "../src/scan/parse.js";
import type { FileUnit } from "../src/scan/parse.js";
import { detectOverAbstraction } from "../src/detectors/overAbstraction.js";
import { detectGenericBoilerplate } from "../src/detectors/genericBoilerplate.js";
import { detectPlausibleButWrong } from "../src/detectors/plausibleButWrong.js";
import { detectDeadParameter } from "../src/detectors/deadParameter.js";

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

  it("flags unreachable code directly after a terminator", () => {
    const code = `
function g() {
  return 1;
  doDeadThing();
}
`;
    const findings = detectPlausibleButWrong(unit(code)).filter((f) =>
      /unreachable/.test(f.evidence),
    );
    expect(findings.length).toBe(1);
    expect(findings[0].evidence).toMatch(/after return/);
  });

  // v0.6.0 fix-unreachable-after-hoisted-decl: a hoisted declaration sitting
  // between the terminator and the truly-dead statement made the scan give up
  // early, so genuinely unreachable code went unflagged (silent false negative).
  it("flags unreachable code that follows a hoisted declaration after a terminator", () => {
    const code = `
function f() {
  return 1;
  function helper() { return 2; }
  runDeadCode();
}
`;
    const findings = detectPlausibleButWrong(unit(code)).filter((f) =>
      /unreachable/.test(f.evidence),
    );
    expect(findings.length).toBe(1);
    expect(findings[0].evidence).toMatch(/after return/);
    // the finding points at the real dead statement, not the hoisted decl
    expect(findings[0].line).toBe(5);
  });

  it("does not flag when only hoisted declarations follow a terminator", () => {
    const code = `
function h() {
  return 1;
  function stillHoisted() { return 2; }
}
`;
    const findings = detectPlausibleButWrong(unit(code)).filter((f) =>
      /unreachable/.test(f.evidence),
    );
    expect(findings).toEqual([]);
  });
});

describe("detectDeadParameter", () => {
  it("fires on a named parameter that is never used in the body", () => {
    const slop = `
export function handle(req: Request, unusedCtx: Context): number {
  return req.id;
}
`;
    const findings = detectDeadParameter(unit(slop));
    expect(findings.length).toBe(1);
    expect(findings[0].category).toBe("dead_parameter");
    expect(findings[0].evidence).toMatch(/unusedCtx/);
    expect(findings[0].evidence).toMatch(/never used|dead parameter/);
  });

  it("does not flag a used parameter, even via shorthand / default", () => {
    const ok = `
export function build(a: number, b = 2) {
  const obj = { a }; // shorthand counts as a use of a
  return obj.a + b;  // b used; obj.a is a member, not a param ref
}
`;
    expect(detectDeadParameter(unit(ok))).toEqual([]);
  });

  it("skips _-prefixed, destructured, rest, and arguments-using params", () => {
    const tolerated = `
export function a(_ignored: number) { return 1; }
export function b({ x }: { x: number }) { return 0; }
export function c(...rest: number[]) { return 0; }
export function d(used: number) { return arguments.length + 0 * used; }
`;
    // `_ignored` skipped (underscore); destructured/rest never flagged;
    // d uses `arguments` so we bail. None should fire.
    expect(detectDeadParameter(unit(tolerated))).toEqual([]);
  });

  it("flags a dead arrow-function parameter (concise body)", () => {
    const slop = `export const f = (a: number, dead: number) => a + 1;`;
    const findings = detectDeadParameter(unit(slop));
    expect(findings.length).toBe(1);
    expect(findings[0].evidence).toMatch(/dead/);
  });

  it("returns [] on clean code", () => {
    expect(detectDeadParameter(unit(CLEAN))).toEqual([]);
  });

  // v0.5.0 fix-dead-param-signature-reference: a parameter used only in the
  // signature (a later param's default, or a type position) was searched only
  // against the body and false-flagged as dead.
  it("does not flag a parameter used only in a later param's default value", () => {
    const code = `export function f(a: number, b: number = a): number { return b; }`;
    const findings = detectDeadParameter(unit(code));
    expect(findings.some((x) => /"a"/.test(x.evidence))).toBe(false);
  });
  it("does not flag a parameter used only in the return type (typeof)", () => {
    // `x` appears ONLY in the return type `typeof x`, never in the body — so a
    // body-only reference search would false-flag it as dead.
    const code = `export function g(x: number): typeof x { return 0 as never; }`;
    const findings = detectDeadParameter(unit(code));
    expect(findings.some((f) => /"x"/.test(f.evidence))).toBe(false);
  });
  it("still flags a genuinely dead parameter alongside signature-only uses", () => {
    const code = `export function h(a: number, b: number = a, dead: number): number { return b; }`;
    const findings = detectDeadParameter(unit(code));
    expect(findings.some((x) => /"dead"/.test(x.evidence))).toBe(true);
    expect(findings.some((x) => /"a"/.test(x.evidence))).toBe(false);
  });
});
