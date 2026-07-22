import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveVersion,
  isEmptyScan,
  writeStepSummary,
  setOutputs,
} from "../scripts/action-entrypoint.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const actionYml = readFileSync(join(here, "..", "action.yml"), "utf8");

/**
 * Extract an input's `default:` string value from action.yml: locate the
 * input's block under `inputs:` (up to the `outputs:` key) and read its
 * `default: "..."` line. A targeted, dependency-free stand-in for a YAML
 * parser (no new runtime dep is allowed in this build).
 */
function inputDefault(yaml: string, inputName: string): string | null {
  const inputsIdx = yaml.indexOf("inputs:");
  expect(inputsIdx).toBeGreaterThan(-1);
  const inputIdx = yaml.indexOf(`  ${inputName}:`, inputsIdx);
  expect(inputIdx).toBeGreaterThan(-1);
  const outputsIdx = yaml.indexOf("outputs:", inputIdx);
  const block = yaml.slice(inputIdx, outputsIdx);
  const m = block.match(/default:\s*"([^"]*)"/);
  expect(m).not.toBeNull();
  return m ? m[1] : null;
}

let tmpDir: string;
let summaryFile: string;
let outputFile: string;
let prevSummary: string | undefined;
let prevOutput: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "slopaudit-action-"));
  summaryFile = join(tmpDir, "summary.md");
  outputFile = join(tmpDir, "outputs.txt");
  writeFileSync(summaryFile, "");
  writeFileSync(outputFile, "");
  prevSummary = process.env.GITHUB_STEP_SUMMARY;
  prevOutput = process.env.GITHUB_OUTPUT;
  process.env.GITHUB_STEP_SUMMARY = summaryFile;
  process.env.GITHUB_OUTPUT = outputFile;
});

afterEach(() => {
  if (prevSummary === undefined) delete process.env.GITHUB_STEP_SUMMARY;
  else process.env.GITHUB_STEP_SUMMARY = prevSummary;
  if (prevOutput === undefined) delete process.env.GITHUB_OUTPUT;
  else process.env.GITHUB_OUTPUT = prevOutput;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("fix-action-stale-cli-version-default", () => {
  it("action.yml version input defaults to latest so the entrypoint runs the current CLI", () => {
    // When no `version` input is given, SLOPAUDIT_VERSION = this default. With
    // "latest" the entrypoint resolves to the current CLI (carrying every
    // v0.4.0+ fix incl. this release's headline unreachable-after-hoisted fix);
    // a pinned literal like "0.3.0" would silently run stale slopaudit@0.3.0
    // and miss all of them.
    expect(inputDefault(actionYml, "version")).toBe("latest");
  });

  it("resolveVersion falls back to latest when the version input is blank", () => {
    expect(resolveVersion({})).toBe("latest");
    expect(resolveVersion({ SLOPAUDIT_VERSION: "" })).toBe("latest");
    expect(resolveVersion({ SLOPAUDIT_VERSION: "   " })).toBe("latest");
  });

  it("resolveVersion honors an explicitly pinned version", () => {
    expect(resolveVersion({ SLOPAUDIT_VERSION: "0.7.0" })).toBe("0.7.0");
    expect(resolveVersion({ SLOPAUDIT_VERSION: "latest" })).toBe("latest");
  });
});

describe("fix-action-empty-scan-false-clean", () => {
  // The CLI's empty-scan path emits this exact JSON to stdout then exits 2.
  const emptyScanScore = {
    score: 0,
    band: "clean",
    filesScanned: 0,
    linesScanned: 0,
    findings: [],
    byFile: {},
  };

  it("isEmptyScan detects the empty-scan JSON (filesScanned===0)", () => {
    expect(isEmptyScan(emptyScanScore)).toBe(true);
    expect(isEmptyScan({ ...emptyScanScore, filesScanned: 5 })).toBe(false);
    expect(isEmptyScan(null)).toBe(false);
    expect(isEmptyScan(undefined)).toBe(false);
  });

  it("does not write a clean badge/summary for an empty scan", () => {
    // The exact false-clean the v0.3.0 empty-scan fix removed, relocated to the
    // Action layer: a valid 0/100 (clean) JSON must NOT render a green badge.
    writeStepSummary(emptyScanScore, "", 2);
    const summary = readFileSync(summaryFile, "utf8");
    expect(summary).not.toContain("SlopScore: 0/100 (clean)");
    expect(summary).not.toContain("🟢");
    expect(summary).toMatch(/no JS\/TS source files|nothing audited|no SlopScore/i);
  });

  it("does not expose score=0 / band=clean step outputs for an empty scan", () => {
    setOutputs(emptyScanScore, 2);
    const out = readFileSync(outputFile, "utf8");
    expect(out).not.toContain("score=0");
    expect(out).not.toContain("band=clean");
    expect(out).toContain("score=\n");
    expect(out).toContain("band=\n");
  });

  it("reports a real score normally (non-empty scan)", () => {
    const realScore = {
      score: 23,
      band: "moderate",
      filesScanned: 5,
      linesScanned: 120,
      findings: [
        {
          file: "src/a.ts",
          line: 4,
          category: "over_abstraction",
          weight: 0.6,
          evidence: "deep wrapper",
        },
      ],
      byFile: { "src/a.ts": 0.4 },
    };
    writeStepSummary(realScore, "moderate", 0);
    const summary = readFileSync(summaryFile, "utf8");
    expect(summary).toContain("SlopScore: 23/100 (moderate)");
    expect(summary).toContain("🟡");
    setOutputs(realScore, 0);
    const out = readFileSync(outputFile, "utf8");
    expect(out).toContain("score=23");
    expect(out).toContain("band=moderate");
  });
});
