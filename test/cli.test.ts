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

/**
 * Same as runCli but with an explicit cwd, so a case can assert on the report
 * artifacts the CLI writes into the CURRENT directory (slopaudit-report.html /
 * slopaudit-badge.svg) without polluting the repo checkout.
 */
function runCliIn(cwd: string, args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [distCli, ...args], { encoding: "utf8", cwd });
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

/**
 * fix-unknown-format-silently-ignored + fix-list-json-silently-dropped — spawn-level
 * regression tests for two silent-drop option paths over the built CLI.
 *
 * v0.16.0 behavior (the bugs):
 *  - `--format <anything-but-github>` was accepted with no validation and fell
 *    through to the default text path: the terminal report printed, and
 *    slopaudit-report.html + slopaudit-badge.svg were written into the cwd, all
 *    with exit 0 — so a CI step asking for a machine format silently got human
 *    output plus workspace mutation.
 *  - `--list` guarded only `--fail-on`, so `--list --json` printed the text
 *    inventory, emitted no JSON, and exited 0 — a step that looks machine-readable
 *    reading non-JSON while reporting success.
 */
describe.skipIf(!cliAvailable)(
  "cli: silently-ignored option values are usage errors (fix-unknown-format-silently-ignored, fix-list-json-silently-dropped)",
  () => {
    let repo: string;

    beforeAll(() => {
      repo = mkdtempSync(join(tmpdir(), "slopaudit-opts-"));
      writeFileSync(join(repo, "ok.ts"), "export const ok = 1;\n");
    });

    afterAll(() => {
      rmSync(repo, { recursive: true, force: true });
    });

    it("an unrecognized --format exits 2 and writes no report artifacts", () => {
      const cwd = mkdtempSync(join(tmpdir(), "slopaudit-fmt-cwd-"));
      try {
        const r = runCliIn(cwd, [repo, "--format", "bogus"]);
        expect(r.status).toBe(2);
        expect(r.stderr).toMatch(/invalid --format value "bogus"/);
        // The v0.16.0 bug wrote both artifacts on this path.
        expect(existsSync(join(cwd, "slopaudit-report.html"))).toBe(false);
        expect(existsSync(join(cwd, "slopaudit-badge.svg"))).toBe(false);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });

    it("`--format json` (the plausible typo for --json) is rejected, not downgraded to text", () => {
      const r = runCli([repo, "--format", "json"]);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/invalid --format value "json"/);
      expect(r.stdout).not.toMatch(/SlopScore:/);
    });

    it("`--format github` still works (the accepted value is unaffected)", () => {
      const r = runCli([repo, "--format", "github", "--no-html", "--no-badge"]);
      expect(r.status).toBe(0);
      expect(r.stdout).not.toMatch(/invalid --format/);
    });

    it("--list combined with --json is rejected instead of silently dropping --json", () => {
      const r = runCli([repo, "--list", "--json"]);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/--json cannot be combined with --list/);
      expect(r.stdout).not.toMatch(/Inventory:/);
    });

    it("--list combined with --format is rejected too", () => {
      const r = runCli([repo, "--list", "--format", "github"]);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/--format cannot be combined with --list/);
    });

    it("--list alone still inventories (exit 0, no behavior change)", () => {
      const r = runCli([repo, "--list"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/Inventory: 1 files/);
    });
  },
);
