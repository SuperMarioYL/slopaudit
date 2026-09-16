import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * fix-parse-failure-units-counted-as-scanned — spawn-level regression tests over
 * the built CLI (dist/cli.js). cli.ts runs `program.parseAsync(process.argv)` at
 * import time, so it cannot be imported into vitest; spawning the built binary
 * is the honest way to pin the CLI's exit-code contract.
 *
 * The suite skips when dist/cli.js is missing (a fresh checkout that was never
 * built); `npm install` runs `prepare: tsc`, so CI and local dev always have it.
 *
 * v0.15.0 behavior (the bug): loadUnit pushed a unit even when parseFile
 * hard-failed (ast:null), so a tree whose ONLY source file is binary garbage
 * reported {"score":0,"band":"clean","filesScanned":1} and exited 0 even at
 * `--fail-on clean` — a pristine green while nothing was audited — and a mixed
 * tree's linesScanned was diluted by the unparseable file's lines.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const distCli = join(root, "dist", "cli.js");
const cliAvailable = existsSync(distCli);

// Binary garbage Babel's errorRecovery cannot recover from: parseFile returns
// { ast: null, error } for exactly this input (verified against the parser).
const BINARY_GARBAGE = Buffer.from([
  0x00, 0x01, 0x02, 0xff, 0xfe, 0x0a, 0xd8, 0x00, 0x0a,
]).toString("latin1");

function runCli(args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [distCli, ...args], { encoding: "utf8" });
}

describe.skipIf(!cliAvailable)(
  "cli: parse failures are not counted as scanned (fix-parse-failure-units-counted-as-scanned)",
  () => {
    let allBinary: string;
    let mixed: string;
    let healthy: string;

    beforeAll(() => {
      allBinary = mkdtempSync(join(tmpdir(), "slopaudit-allbin-"));
      writeFileSync(join(allBinary, "junk.ts"), BINARY_GARBAGE);

      mixed = mkdtempSync(join(tmpdir(), "slopaudit-mixed-"));
      writeFileSync(join(mixed, "junk.ts"), BINARY_GARBAGE);
      writeFileSync(join(mixed, "ok.ts"), "export const ok = 1;\n");

      healthy = mkdtempSync(join(tmpdir(), "slopaudit-healthy-"));
      writeFileSync(join(healthy, "ok.ts"), "export const ok = 1;\n");
    });

    afterAll(() => {
      for (const d of [allBinary, mixed, healthy]) {
        rmSync(d, { recursive: true, force: true });
      }
    });

    it("an all-unparseable tree exits 2 (nothing audited), not a pristine 0/100 green", () => {
      // v0.15.0: filesScanned counted the unparseable unit => score 0 / clean,
      // exit 0 even at --fail-on clean. Now: the empty-scan usage error (exit 2).
      const r = runCli([allBinary, "--json", "--fail-on", "clean"]);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/none could be parsed/);
      // --json still emits the empty score first so machine consumers see
      // filesScanned: 0 (the established empty-scan contract).
      const score = JSON.parse(r.stdout);
      expect(score.filesScanned).toBe(0);
    });

    it("a mixed tree counts only the parseable file (no linesScanned dilution)", () => {
      const r = runCli([mixed, "--json"]);
      expect(r.status).toBe(0);
      const score = JSON.parse(r.stdout);
      expect(score.filesScanned).toBe(1);
      // junk.ts contributes nothing: only ok.ts's single line is counted.
      expect(score.linesScanned).toBe(1);
    });

    it("a healthy tree still exits 0 (no behavior change on parseable files)", () => {
      const r = runCli([healthy, "--json"]);
      expect(r.status).toBe(0);
      const score = JSON.parse(r.stdout);
      expect(score.filesScanned).toBe(1);
      expect(score.linesScanned).toBe(1);
    });

    it("the no-files case keeps its message (empty-scan semantics unchanged)", () => {
      const empty = mkdtempSync(join(tmpdir(), "slopaudit-empty-"));
      try {
        const r = runCli([empty]);
        expect(r.status).toBe(2);
        expect(r.stderr).toMatch(/no JS\/TS source files found/);
      } finally {
        rmSync(empty, { recursive: true, force: true });
      }
    });
  },
);
