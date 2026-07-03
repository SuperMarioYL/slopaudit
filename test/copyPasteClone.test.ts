import { describe, it, expect } from "vitest";
import { parseFile } from "../src/scan/parse.js";
import type { FileUnit } from "../src/scan/parse.js";
import { detectCopyPasteClone } from "../src/detectors/copyPasteClone.js";

/** Build a FileUnit from an inline code string, the same shape cli.ts produces. */
function unit(code: string, file = "fixture.ts"): FileUnit {
  const { ast, lineCount } = parseFile(file, code);
  return { file, code, lineCount, ast };
}

describe("detectCopyPasteClone", () => {
  it("flags a near-duplicate block (copied then lightly edited)", () => {
    // Second block is the first copy-pasted, renamed, and with ONE extra
    // statement inserted — an exact-ordered matcher misses it; the fuzzy
    // statement-multiset overlap catches it.
    const slop = `
function renderUserCard(u: User): string {
  const name = u.name.trim();
  const email = u.email.toLowerCase();
  const avatar = u.avatar || DEFAULT_AVATAR;
  const role = u.role ?? "member";
  const badge = roleBadge(role);
  return html(name, email, avatar, badge);
}
function renderAdminCard(a: Admin): string {
  const name = a.name.trim();
  const email = a.email.toLowerCase();
  const avatar = a.avatar || DEFAULT_AVATAR;
  const role = a.role ?? "admin";
  const badge = roleBadge(role);
  const audit = a.lastAudit;
  return html(name, email, avatar, badge);
}
`;
    const findings = detectCopyPasteClone(unit(slop));
    expect(findings.length).toBe(1);
    const clone = findings[0];
    expect(clone.category).toBe("copy_paste_clone");
    expect(clone.line).toBeGreaterThan(9); // the second (admin) function body
    expect(clone.evidence).toMatch(/copy-paste clone/);
    expect(clone.evidence).toMatch(/shared structure with the block at line \d+/);
    expect(clone.weight).toBeGreaterThan(0);
  });

  it("catches a reordered clone that an exact ordered match misses", () => {
    const reordered = `
function alpha(u: User): Result {
  const id = u.id;
  const name = u.name.trim();
  const active = u.status === "active";
  const score = compute(u.metrics);
  return { id, name, active, score };
}
function beta(a: Account): Result {
  const name = a.name.trim();
  const id = a.id;
  const score = compute(a.metrics);
  const active = a.status === "active";
  return { id, name, active, score };
}
`;
    const findings = detectCopyPasteClone(unit(reordered));
    expect(findings.length).toBe(1);
    expect(findings[0].category).toBe("copy_paste_clone");
  });

  it("does NOT flag exact-ordered duplicates (that is genericBoilerplate's job — no double count)", () => {
    const exact = `
function processUser(u: User): Result {
  const id = u.id;
  const name = u.name.trim();
  const active = u.status === "active";
  return { id, name, active };
}
function processAccount(a: Account): Result {
  const id = a.id;
  const name = a.name.trim();
  const active = a.status === "active";
  return { id, name, active };
}
`;
    expect(detectCopyPasteClone(unit(exact))).toEqual([]);
  });

  it("does not flag structurally different blocks", () => {
    const clean = `
function sum(xs: number[]): number {
  let total = 0;
  for (const x of xs) total += x;
  return total;
}
function greet(name: string): string {
  const trimmed = name.trim();
  const upper = trimmed.toUpperCase();
  return "HELLO " + upper;
}
`;
    expect(detectCopyPasteClone(unit(clean))).toEqual([]);
  });

  it("does not flag tiny duplicated blocks below the statement floor", () => {
    const tiny = `
function a() { return 1; }
function b() { return 2; }
function c() { return 3; }
`;
    expect(detectCopyPasteClone(unit(tiny))).toEqual([]);
  });

  it("returns [] when there is no AST", () => {
    expect(detectCopyPasteClone({ file: "x.ts", code: "", lineCount: 0, ast: null })).toEqual([]);
  });
});
