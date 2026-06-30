#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { Command } from "commander";

import { walk } from "./scan/walk.js";
import { parseFile } from "./scan/parse.js";
import { detectOverAbstraction } from "./detectors/overAbstraction.js";
import { detectGenericBoilerplate } from "./detectors/genericBoilerplate.js";
import { detectPlausibleButWrong } from "./detectors/plausibleButWrong.js";
import { detectDeadParameter } from "./detectors/deadParameter.js";
import { aggregate } from "./score/aggregate.js";
import { gateTrips, InvalidThresholdError } from "./gate/threshold.js";
import { renderTerminal, renderInventory } from "./report/terminal.js";
import { renderHtml } from "./report/html.js";
import { renderBadge } from "./report/badge.js";
import type { FileUnit } from "./scan/parse.js";
import type { SlopFinding } from "./types.js";

/**
 * Single-source the version from package.json instead of a hardcoded constant, so
 * `slopaudit --version` can never drift from the published release. The compiled
 * cli.js lives in dist/, so package.json is one directory up from it; fall back to
 * a sentinel only if the manifest is somehow unreadable.
 */
function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    if (typeof pkg.version === "string" && pkg.version.length > 0) return pkg.version;
  } catch {
    // fall through to sentinel
  }
  return "0.0.0";
}

const VERSION = readVersion();

interface RunOptions {
  json?: boolean;
  html?: boolean; // commander: --no-html => html === false
  badge?: boolean; // commander: --no-badge => badge === false
  list?: boolean;
  failOn?: string; // m4: --fail-on <band|score> CI gate threshold
}

/**
 * Read + parse a single file into a FileUnit, or null if it can't be read.
 * parse.ts uses errorRecovery so a parse never throws; a soft error is logged
 * to stderr but the unit is still produced with whatever AST was recovered.
 */
async function loadUnit(filePath: string): Promise<FileUnit | null> {
  let code: string;
  try {
    code = await readFile(filePath, "utf8");
  } catch {
    return null;
  }
  const { ast, lineCount, error } = parseFile(filePath, code);
  if (error) {
    process.stderr.write(`slopaudit: parse warning for ${filePath}: ${error}\n`);
  }
  return { file: filePath, code, lineCount, ast };
}

async function collectUnits(root: string): Promise<FileUnit[]> {
  const files = await walk(root);
  const units: FileUnit[] = [];
  for (const f of files) {
    const unit = await loadUnit(f);
    if (unit) units.push(unit);
  }
  return units;
}

async function runList(rootArg: string): Promise<void> {
  const root = resolve(rootArg);
  const units = await collectUnits(root);
  const inventory = units.map((u) => ({ file: u.file, lineCount: u.lineCount }));
  process.stdout.write(renderInventory(inventory) + "\n");
}

async function runAudit(rootArg: string, opts: RunOptions): Promise<void> {
  const root = resolve(rootArg);
  const units = await collectUnits(root);

  const findings: SlopFinding[] = [];
  let linesScanned = 0;
  for (const unit of units) {
    linesScanned += unit.lineCount;
    findings.push(...detectOverAbstraction(unit));
    findings.push(...detectGenericBoilerplate(unit));
    findings.push(...detectPlausibleButWrong(unit));
    findings.push(...detectDeadParameter(unit));
  }

  const score = aggregate(findings, {
    filesScanned: units.length,
    linesScanned,
  });

  // fix-empty-scan-silent-pass: an empty file list (non-existent root, typo'd
  // workdir, or a dir with no JS/TS) yields score 0 / band "clean" / filesScanned
  // 0 — a false green in the headline CI gate. Treat "nothing audited" as a usage
  // error (exit 2) rather than a pristine pass. In --json mode we still emit the
  // empty score first so machine consumers see filesScanned: 0, then exit 2
  // without applying the gate (there is nothing to gate on).
  if (score.filesScanned === 0) {
    if (opts.json) {
      process.stdout.write(JSON.stringify(score, null, 2) + "\n");
    }
    process.stderr.write(
      `slopaudit: no JS/TS source files found under ${root} — nothing audited\n`,
    );
    process.exitCode = 2;
    return;
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(score, null, 2) + "\n");
    // m4: the CI gate still applies in --json mode (the JSON is emitted first).
    applyGate(score, opts.failOn);
    return;
  }

  process.stdout.write(renderTerminal(score) + "\n");

  const written: string[] = [];
  if (opts.html !== false) {
    const htmlPath = resolve(process.cwd(), "slopaudit-report.html");
    await writeFile(htmlPath, renderHtml(score), "utf8");
    written.push("slopaudit-report.html");
  }
  if (opts.badge !== false) {
    const badgePath = resolve(process.cwd(), "slopaudit-badge.svg");
    await writeFile(badgePath, renderBadge(score), "utf8");
    written.push("slopaudit-badge.svg");
  }
  if (written.length > 0) {
    process.stdout.write(`Wrote ${written.join(", ")}\n`);
  }

  // m4: CI fail-gate — evaluated last, after the report + artifacts.
  applyGate(score, opts.failOn);
}

/**
 * m4 CI gate. When `--fail-on <band|score>` is set and the SlopScore meets or
 * exceeds the threshold, set a non-zero exit code so a CI job fails the PR. An
 * invalid threshold is a usage error (exit 2). No-op when `--fail-on` is absent.
 */
function applyGate(
  score: import("./types.js").SlopScore,
  failOn: string | undefined,
): void {
  if (failOn === undefined) return;
  try {
    if (gateTrips(score, failOn)) {
      process.stderr.write(
        `slopaudit: SlopScore ${score.score}/100 (${score.band}) ` +
          `meets or exceeds --fail-on ${failOn}\n`,
      );
      process.exitCode = 1;
    }
  } catch (err) {
    if (err instanceof InvalidThresholdError) {
      process.stderr.write(`slopaudit: ${err.message}\n`);
      process.exitCode = 2;
      return;
    }
    throw err;
  }
}

const program = new Command();

program
  .name("slopaudit")
  .description(
    "Audit a JS/TS repo for AI-generated code slop debt. Emits a SlopScore (0-100) + heatmap. 100% static, offline, deterministic.",
  )
  .version(VERSION, "-v, --version", "output the version number")
  .argument("[path]", "directory to audit", ".")
  .option("--json", "print the SlopScore as JSON to stdout (for CI)")
  .option("--no-html", "skip writing slopaudit-report.html")
  .option("--no-badge", "skip writing slopaudit-badge.svg")
  .option("--list", "m1 inventory only: list files + line counts, no scoring")
  .option(
    "--fail-on <threshold>",
    "exit non-zero if the SlopScore meets/exceeds <threshold> (band clean|moderate|heavy, or an integer 0-100) — for CI gating",
  )
  .action(async (path: string, opts: RunOptions) => {
    try {
      if (opts.list) {
        // fix-list-ignores-fail-on: --list only prints the inventory and never
        // evaluates the gate, so a `--list --fail-on …` step looks like it gates
        // but silently doesn't. Reject the combination as a usage error (exit 2)
        // rather than dropping --fail-on on the floor.
        if (opts.failOn !== undefined) {
          process.stderr.write(
            "slopaudit: --fail-on has no effect with --list (inventory mode does " +
              "not compute a SlopScore); drop --list to gate, or drop --fail-on\n",
          );
          process.exitCode = 2;
          return;
        }
        await runList(path);
      } else {
        await runAudit(path, opts);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`slopaudit: ${msg}\n`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
