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

  it("counts lines", () => {
    const res = parseFile("m.ts", "const a = 1;\nconst b = 2;\nconst c = 3;\n");
    expect(res.lineCount).toBe(4);
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
