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

  it("collects the real .ts/.jsx/.js sources", async () => {
    const files = await walk(root);
    const names = files.map((f) => path.basename(f)).sort();
    expect(names).toEqual(["a.ts", "comp.jsx", "util.js", "z.ts"]);
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
