import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { walk } from "../src/scan/walk.js";
import { parseFile } from "../src/scan/parse.js";

describe("walk()", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "slopaudit-walk-"));
    // real source files (out of lexicographic order on purpose)
    writeFileSync(path.join(root, "z.ts"), "export const z = 1;\n");
    writeFileSync(path.join(root, "a.ts"), "export const a = 1;\n");
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(path.join(root, "src", "comp.jsx"), "export const C = () => null;\n");
    writeFileSync(path.join(root, "src", "util.js"), "module.exports = {};\n");
    // fix-walk-misses-mjs-cjs-mts-cts-under-audit: ESM/CJS/TS-variant source
    // files (config / package-entry-point shapes modern repos increasingly use)
    // that the old 4-extension glob silently dropped — they must now be collected.
    writeFileSync(path.join(root, "config.mjs"), "export default {};\n");
    writeFileSync(path.join(root, "build.cjs"), "module.exports = {};\n");
    writeFileSync(path.join(root, "types.mts"), "export const t = 1;\n");
    // fix-walk-scans-d-mts-d-cts-declaration-files: TypeScript ESM/CJS declaration
    // files (the declaration variant of .d.ts) must be skipped exactly like .d.ts —
    // they carry no executable code, so scanning them emits noise findings on
    // legitimate `declare`/`any` JS-interop constructs and dilutes linesScanned.
    writeFileSync(path.join(root, "api.d.mts"), "export declare function f(x: any): any;\n");
    writeFileSync(path.join(root, "api.d.cts"), "export declare const c: any;\n");
    writeFileSync(path.join(root, "api.d.ts"), "export declare function g(x: any): any;\n");
    // should be skipped: node_modules + dist
    mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
    writeFileSync(path.join(root, "node_modules", "pkg", "index.js"), "module.exports = 0;\n");
    mkdirSync(path.join(root, "dist"), { recursive: true });
    writeFileSync(path.join(root, "dist", "bundle.js"), "console.log(1);\n");
    // non-source files ignored
    writeFileSync(path.join(root, "README.md"), "# hi\n");
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns absolute paths", async () => {
    const files = await walk(root);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(path.isAbsolute(f)).toBe(true);
    }
  });

  it("returns paths sorted lexicographically", async () => {
    const files = await walk(root);
    const copy = [...files].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(files).toEqual(copy);
  });

  it("skips node_modules and dist", async () => {
    const files = await walk(root);
    expect(files.some((f) => f.includes(`${path.sep}node_modules${path.sep}`))).toBe(false);
    expect(files.some((f) => f.includes(`${path.sep}dist${path.sep}`))).toBe(false);
  });

  it("collects the real .ts/.jsx/.js/.mjs/.cjs/.mts sources", async () => {
    const files = await walk(root);
    const names = files.map((f) => path.basename(f)).sort();
    expect(names).toEqual(["a.ts", "build.cjs", "comp.jsx", "config.mjs", "types.mts", "util.js", "z.ts"]);
  });

  it("collects .mjs/.cjs/.mts config-style files (fix-walk-misses-mjs-cjs-mts-cts-under-audit)", async () => {
    // The old glob "**/*.{js,jsx,ts,tsx}" silently dropped these ESM/CJS/TS
    // variants, so a repo whose only slop lived in one scored 0/100 (clean)
    // and PASSED `--fail-on` — a false green in the headline CI gate (the same
    // defect class as fix-empty-scan-silent-pass). Fails on the 4-extension
    // pattern, passes now that walk() globs mjs/cjs/mts/cts too.
    const files = await walk(root);
    const names = files.map((f) => path.basename(f));
    expect(names).toContain("config.mjs");
    expect(names).toContain("build.cjs");
    expect(names).toContain("types.mts");
  });

  it("skips .d.mts/.d.cts TypeScript declaration files (fix-walk-scans-d-mts-d-cts-declaration-files)", async () => {
    // A ".d.mts"/".d.cts" TypeScript ESM/CJS declaration file is the declaration
    // variant of ".d.ts" — it carries no executable code, so scanning it emits noise
    // findings on legitimate `declare`/`any` JS-interop constructs and dilutes
    // linesScanned (able to pull a moderate repo below the --fail-on moderate/heavy
    // ceiling into a false-clean PASS). It must be skipped exactly like ".d.ts"
    // (already excluded). Fails when walk() globs .mts/.cts without excluding
    // .d.mts/.d.cts; passes once they are added to the ignore list next to .d.ts.
    const files = await walk(root);
    const names = files.map((f) => path.basename(f));
    expect(names).not.toContain("api.d.mts");
    expect(names).not.toContain("api.d.cts");
    expect(names).not.toContain("api.d.ts");
    // and the real .mts source IS still collected (the .d exclusion is suffix-specific)
    expect(names).toContain("types.mts");
  });

  it("collects dotfile JS/TS config sources like .eslintrc.cjs (fix-walk-dotfalse-skips-dotfile-configs)", async () => {
    // fast-glob with `dot: false` silently drops dot-FILES (not just dot-dirs),
    // so a real JS/TS source config file like `.eslintrc.cjs` / `.babelrc.js`
    // never matched the glob and was dropped from the audit — a repo whose only
    // slop lived in a dotfile config (a common shape: an over-abstracted
    // `.eslintrc.cjs` factory) scored 0/100 (clean) and PASSED `--fail-on`
    // (a false green in the headline CI gate, the same defect class as the
    // v0.9.0 .mjs/.cjs/.mts/.cts fix). Fails when walk() runs with `dot: false`;
    // passes once `dot: true` is set (the ignore list still excludes .git /
    // node_modules, so only real dotfile source configs are re-included).
    const dotRoot = mkdtempSync(path.join(tmpdir(), "slopaudit-walk-dot-"));
    try {
      writeFileSync(path.join(dotRoot, ".eslintrc.cjs"), "module.exports = { slop: true };\n");
      writeFileSync(path.join(dotRoot, "normal.ts"), "export const n = 1;\n");
      const files = await walk(dotRoot);
      const names = files.map((f) => path.basename(f));
      expect(names).toContain(".eslintrc.cjs");
      expect(names).toContain("normal.ts");
    } finally {
      rmSync(dotRoot, { recursive: true, force: true });
    }
  });

  it("skips .min.mjs minified ESM bundles (fix-walk-min-mjs-cjs-mts-cts-not-excluded)", async () => {
    // The ignore list excluded .min.js / .min.jsx / .bundle.js but NOT the
    // .mjs/.cjs/.mts/.cts variants that the v0.9.0 glob addition introduced, so
    // a minified ESM/CJS/TS-variant bundle committed outside the ignored build
    // dirs (e.g. `lib.min.mjs` at the repo root) WAS collected and audited as
    // executable source — emitting noise findings on dense repeated tokens and
    // inflating linesScanned, diluting the per-100-lines density and dragging
    // the SlopScore down into a false-clean PASS (the same score-distortion
    // defect class as the v0.10.0 .d.mts/.d.cts fix). Fails on the old 3-arm
    // minified ignore; passes once the .min.mjs / .min.cjs / .min.mts / .min.cts
    // (and .bundle.* variants) arms are added next to .min.js.
    const minRoot = mkdtempSync(path.join(tmpdir(), "slopaudit-walk-min-"));
    try {
      writeFileSync(path.join(minRoot, "lib.min.mjs"), "export const a=1,b=2,c=3,d=4,e=5;\n");
      writeFileSync(path.join(minRoot, "real.ts"), "export const r = 1;\n");
      const files = await walk(minRoot);
      const names = files.map((f) => path.basename(f));
      expect(names).not.toContain("lib.min.mjs");
      // the real (non-minified) source is still collected
      expect(names).toContain("real.ts");
    } finally {
      rmSync(minRoot, { recursive: true, force: true });
    }
  });

  it("honors a user-supplied --ignore glob (feat-ignore-user-globs)", async () => {
    // walk() hardcodes its ignore array and exposes no way to extend it, so any
    // repo-specific generated/vendored/example dir NOT in the built-in list
    // (examples/, benchmarks/, e2e fixtures, __snapshots__/, a custom outDir)
    // is collected and audited as executable source — emitting noise findings
    // on example/generated code and inflating linesScanned, exactly the
    // score-distortion shape the v0.9-v0.11 fixes removed for the built-in dirs.
    // The repeatable --ignore <glob> CLI flag threads an extra ignore array
    // through walk(root, extraIgnores), appended to the built-in ignore list
    // (extraIgnores defaults to [] so walk(root) stays back-compatible with
    // every existing test). Fails when walk() ignores its 2nd arg (returns
    // examples/slop.ts); passes once extraIgnores is appended to the ignore array.
    const ignoreRoot = mkdtempSync(path.join(tmpdir(), "slopaudit-walk-ignore-"));
    try {
      writeFileSync(path.join(ignoreRoot, "real.ts"), "export const r = 1;\n");
      mkdirSync(path.join(ignoreRoot, "examples"), { recursive: true });
      writeFileSync(path.join(ignoreRoot, "examples", "slop.ts"), "export const s = 1;\n");

      // No extra ignore: both the real source and the example file are collected
      // (examples/ is NOT in the built-in ignore list, so it is audited today).
      const all = await walk(ignoreRoot);
      const allNames = all.map((f) => path.basename(f));
      expect(allNames).toContain("real.ts");
      expect(allNames).toContain("slop.ts");

      // With --ignore examples/**: examples/slop.ts is excluded while real.ts is
      // still collected.
      const filtered = await walk(ignoreRoot, ["examples/**"]);
      const filteredNames = filtered.map((f) => path.basename(f));
      expect(filteredNames).toContain("real.ts");
      expect(filteredNames).not.toContain("slop.ts");
    } finally {
      rmSync(ignoreRoot, { recursive: true, force: true });
    }
  });
});

describe("parseFile()", () => {
  it("returns an AST for valid TS", () => {
    const res = parseFile("a.ts", "const x: number = 1; export function f(a: string): string { return a; }");
    expect(res.ast).not.toBeNull();
    expect(res.ast.type).toBe("File");
    expect(res.error).toBeUndefined();
    expect(res.lineCount).toBeGreaterThanOrEqual(1);
  });

  it("returns an AST for valid JSX", () => {
    const res = parseFile("c.jsx", "const C = () => <div className=\"x\">hi</div>;");
    expect(res.ast).not.toBeNull();
    expect(res.ast.type).toBe("File");
  });

  it("parses a class with `@deco accessor x = 1` auto-accessor fields", () => {
    // fix-parser-accessor-decorators: without the decoratorAutoAccessors plugin
    // this threw a non-recoverable plugin error and the file was dropped (ast:null).
    const src = `
function logged(target: any) { return target; }
class Counter {
  @logged accessor count = 0;
  inc() { this.count++; }
}
`;
    const res = parseFile("accessor.ts", src);
    expect(res.ast).not.toBeNull();
    expect(res.ast.type).toBe("File");
    expect(res.error).toBeUndefined();
  });

  it("counts a trailing-newline-terminated file as one line per newline (fix-countlines-trailing-newline-off-by-one)", () => {
    // countLines() used to return (#"\n")+1, so a source file ending in a
    // trailing "\n" — the standard shape prettier/eslint/git enforce for ~all
    // files — spawned a phantom empty last line: a 3-line
    // "const a=1;\n…c=3;\n" was counted as 4 (this wrong value was even codified
    // here as .toBe(4)). lineCount feeds linesScanned and the SlopScore density
    // (totalWeight/linesScanned)*100, so both were inflated, dragging the score
    // down toward a false-clean PASS at the --fail-on gate. Now countLines
    // follows the wc -l / editor convention. Fails (.toBe(4) on the old
    // #"\n"+1 implementation; expects .toBe(3)) — red before the fix, green after.
    const res = parseFile("m.ts", "const a = 1;\nconst b = 2;\nconst c = 3;\n");
    expect(res.lineCount).toBe(3);
  });

  it("counts a file with no trailing newline as #newlines + 1 (fix-countlines-trailing-newline-off-by-one)", () => {
    // Guard: a file with NO trailing "\n" still has one more line than its
    // newline count (the final unterminated line). "a\nb\nc" has 2 newlines =>
    // 3 lines. This case was already correct under the old #"\n"+1 rule; the
    // fix must not regress it.
    const res = parseFile("m.ts", "a\nb\nc");
    expect(res.lineCount).toBe(3);
  });

  it("counts an empty file as 0 lines (fix-countlines-trailing-newline-off-by-one)", () => {
    // Guard: an empty file is 0 lines (not 1), matching wc -l and keeping a
    // 0-byte file from inflating linesScanned. Already correct under both the
    // old and new rules; pinned so the fix's empty-file fast path stays 0.
    const res = parseFile("e.ts", "");
    expect(res.lineCount).toBe(0);
  });

  it("returns { ast: null, error } for malformed input without throwing", () => {
    // Garbage that even errorRecovery cannot parse into a File.
    const malformed = "const = = = ) ) } } class class 123abc <<< @#$%";
    let res;
    expect(() => {
      res = parseFile("bad.ts", malformed);
    }).not.toThrow();
    expect(res).toBeDefined();
    expect(res!.ast).toBeNull();
    expect(typeof res!.error).toBe("string");
    expect(res!.error!.length).toBeGreaterThan(0);
  });
});
