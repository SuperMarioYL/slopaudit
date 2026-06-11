#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Command } from "commander";

import { walk } from "./scan/walk.js";
import { parseFile } from "./scan/parse.js";
import { detectOverAbstraction } from "./detectors/overAbstraction.js";
import { detectGenericBoilerplate } from "./detectors/genericBoilerplate.js";
import { detectPlausibleButWrong } from "./detectors/plausibleButWrong.js";
import { aggregate } from "./score/aggregate.js";
import { renderTerminal, renderInventory } from "./report/terminal.js";
import { renderHtml } from "./report/html.js";
import { renderBadge } from "./report/badge.js";
import type { FileUnit } from "./scan/parse.js";
import type { SlopFinding } from "./types.js";

const VERSION = "0.1.0";

interface RunOptions {
  json?: boolean;
  html?: boolean; // commander: --no-html => html === false
  badge?: boolean; // commander: --no-badge => badge === false
  list?: boolean;
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
  }

  const score = aggregate(findings, {
    filesScanned: units.length,
    linesScanned,
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify(score, null, 2) + "\n");
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
  .action(async (path: string, opts: RunOptions) => {
    try {
      if (opts.list) {
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
