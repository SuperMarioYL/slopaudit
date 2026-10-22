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
import { detectCopyPasteClone } from "./detectors/copyPasteClone.js";
import { aggregate } from "./score/aggregate.js";
import { gateTrips, InvalidThresholdError } from "./gate/threshold.js";
import { renderTerminal, renderInventory } from "./report/terminal.js";
import { renderHtml } from "./report/html.js";
import { renderBadge } from "./report/badge.js";
import { renderGithubAnnotations } from "./report/github.js";
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

/**
 * feat-ignore-user-globs: commander coercion for the repeatable `--ignore <glob>`
 * flag. Each occurrence appends its value to the running array (initial value
 * `[]`), so `--ignore examples/** --ignore "bench/**"` yields
 * `["examples/**", "bench/**"]` threaded through collectUnits -> walk(root,
 * extraIgnores) and appended to walk()'s built-in ignore list.
 */
function collectIgnore(value: string, previous: string[]): string[] {
  return previous.concat(value);
}

/**
 * fix-unknown-format-silently-ignored: `--format` is a closed set — `github` is
 * the only output format implemented (the m7 inline-annotation emitter). The
 * option previously had no value validation and a single consumer
 * (`opts.format === "github"` in runAudit), so any other value — a typo like
 * `--format github-actions`, or `--format json` confused with the separate
 * `--json` flag — fell straight through to the default text path, which printed
 * the human report, wrote slopaudit-report.html + slopaudit-badge.svg into the
 * cwd and exited 0. A CI step that asked for a machine format therefore
 * reported success while producing the wrong artifact and mutating the
 * workspace. Resolve the value up front and treat an unrecognized one as a
 * usage error (exit 2), exactly like an invalid `--fail-on` threshold.
 */
const KNOWN_FORMATS = ["github"] as const;
type OutputFormat = (typeof KNOWN_FORMATS)[number];

class InvalidFormatError extends Error {
  constructor(raw: string) {
    super(
      `invalid --format value "${raw}": expected one of ` +
        `${KNOWN_FORMATS.join("|")} (omit the flag for the default text report)`,
    );
    this.name = "InvalidFormatError";
  }
}

/**
 * Resolve `--format` to a known output format, or `undefined` when the flag was
 * omitted (default text report). Throws `InvalidFormatError` for anything else.
 * Trimmed + case-folded like `resolveThreshold`, so the two value options share
 * one convention.
 */
function resolveFormat(raw: string | undefined): OutputFormat | undefined {
  if (raw === undefined) return undefined;
  const normalized = raw.trim().toLowerCase();
  if ((KNOWN_FORMATS as readonly string[]).includes(normalized)) {
    return normalized as OutputFormat;
  }
  throw new InvalidFormatError(raw);
}

interface RunOptions {
  json?: boolean;
  html?: boolean; // commander: --no-html => html === false
  badge?: boolean; // commander: --no-badge => badge === false
  list?: boolean;
  failOn?: string; // m4: --fail-on <band|score> CI gate threshold
  format?: string; // m7: --format github => GitHub Actions inline annotations
  ignore?: string[]; // feat-ignore-user-globs: repeatable --ignore <glob>
}

/**
 * Read + parse a single file into a FileUnit, or null if it can't be read.
 * parse.ts uses errorRecovery so a parse never throws; a soft error is logged
 * to stderr but the unit is still produced with whatever AST was recovered.
 *
 * fix-parse-failure-units-counted-as-scanned: a HARD parse failure (parseFile
 * returned `ast: null`) produces a unit every detector returns [] for, so the
 * file contributed zero findings while its lines still inflated linesScanned
 * and filesScanned counted a file that was never audited — diluting the
 * per-100-lines density toward a false-clean PASS, and letting a tree whose
 * ONLY source file is unparseable report a pristine 0/100 (clean) green at
 * `--fail-on clean` (the v0.3.0 empty-scan guard only fires at
 * filesScanned === 0). The unit is now dropped; the parse warning already went
 * to stderr, and runAudit reports the unparseable count in the nothing-audited
 * message.
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
  if (!ast) return null; // hard parse failure — nothing was audited in this file
  return { file: filePath, code, lineCount, ast };
}

/**
 * The walked files plus how many were found but dropped as unparseable (hard
 * parse failure). fix-parse-failure-units-counted-as-scanned: runAudit needs
 * the count so its zero-scan error can say "found but none could be parsed"
 * instead of "no JS/TS source files found".
 */
interface CollectedUnits {
  units: FileUnit[];
  unparseable: number;
}

async function collectUnits(
  root: string,
  extraIgnores: string[] = [],
): Promise<CollectedUnits> {
  const files = await walk(root, extraIgnores);
  const units: FileUnit[] = [];
  let unparseable = 0;
  for (const f of files) {
    const unit = await loadUnit(f);
    if (unit) units.push(unit);
    else unparseable++;
  }
  return { units, unparseable };
}

async function runList(rootArg: string, opts: RunOptions): Promise<void> {
  const root = resolve(rootArg);
  const { units } = await collectUnits(root, opts.ignore ?? []);
  const inventory = units.map((u) => ({ file: u.file, lineCount: u.lineCount }));
  process.stdout.write(renderInventory(inventory) + "\n");
}

async function runAudit(rootArg: string, opts: RunOptions): Promise<void> {
  const root = resolve(rootArg);
  const { units, unparseable } = await collectUnits(root, opts.ignore ?? []);

  const findings: SlopFinding[] = [];
  let linesScanned = 0;
  const linesByFile: Record<string, number> = {};
  for (const unit of units) {
    linesScanned += unit.lineCount;
    linesByFile[unit.file] = unit.lineCount;
    findings.push(...detectOverAbstraction(unit));
    findings.push(...detectGenericBoilerplate(unit));
    findings.push(...detectPlausibleButWrong(unit));
    findings.push(...detectDeadParameter(unit));
    findings.push(...detectCopyPasteClone(unit));
  }

  const score = aggregate(findings, {
    filesScanned: units.length,
    linesScanned,
    // Real per-file line counts so the byFile heatmap ranks by each file's own
    // slop density, not the repo average.
    linesByFile,
  });

  // fix-empty-scan-silent-pass: an empty file list (non-existent root, typo'd
  // workdir, or a dir with no JS/TS) yields score 0 / band "clean" / filesScanned
  // 0 — a false green in the headline CI gate. Treat "nothing audited" as a usage
  // error (exit 2) rather than a pristine pass. In --json mode we still emit the
  // empty score first so machine consumers see filesScanned: 0, then exit 2
  // without applying the gate (there is nothing to gate on).
  //
  // fix-parse-failure-units-counted-as-scanned: unparseable files no longer
  // count toward filesScanned, so a tree whose only source file fails to parse
  // lands here too instead of reporting a pristine 0/100 green that passes even
  // `--fail-on clean` while nothing was audited. Say which case it was.
  if (score.filesScanned === 0) {
    if (opts.json) {
      process.stdout.write(JSON.stringify(score, null, 2) + "\n");
    }
    process.stderr.write(
      unparseable > 0
        ? `slopaudit: ${unparseable} JS/TS file(s) found under ${root} but none could be parsed — nothing audited\n`
        : `slopaudit: no JS/TS source files found under ${root} — nothing audited\n`,
    );
    process.exitCode = 2;
    return;
  }

  if (opts.format === "github") {
    // m7: emit one `::warning file=…,line=…::…` workflow command per finding so
    // the packaged Action renders inline per-line slop annotations on the PR
    // diff. Pure formatter over the same score; the gate still applies (after
    // the annotations are written) exactly like --json.
    const annotations = renderGithubAnnotations(score, process.cwd());
    if (annotations.length > 0) {
      process.stdout.write(annotations + "\n");
    }
    applyGate(score, opts.failOn);
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
  .option(
    "--format <format>",
    "output format: only 'github' is accepted — it emits a GitHub Actions ::warning workflow command per finding (inline per-line PR annotations); omit the flag for the default text report",
  )
  .option("--no-html", "skip writing slopaudit-report.html")
  .option("--no-badge", "skip writing slopaudit-badge.svg")
  .option("--list", "m1 inventory only: list files + line counts, no scoring")
  .option(
    "--fail-on <threshold>",
    "exit non-zero if the SlopScore meets/exceeds <threshold> (band clean|moderate|heavy, or an integer 0-100) — for CI gating",
  )
  .option(
    "--ignore <glob>",
    "glob of files/dirs to exclude from the audit (repeatable, e.g. --ignore 'examples/**' --ignore 'bench/**') for repo-specific generated/vendored/example dirs the built-in ignore list misses",
    collectIgnore,
    [],
  )
  .action(async (path: string, opts: RunOptions) => {
    try {
      // fix-unknown-format-silently-ignored: resolve --format before anything
      // else so an unrecognized value is a usage error instead of a silent
      // fall-through to the default text report.
      let format: OutputFormat | undefined;
      try {
        format = resolveFormat(opts.format);
      } catch (err) {
        if (err instanceof InvalidFormatError) {
          process.stderr.write(`slopaudit: ${err.message}\n`);
          process.exitCode = 2;
          return;
        }
        throw err;
      }

      if (opts.list) {
        // fix-list-ignores-fail-on / fix-list-json-silently-dropped: --list only
        // prints the inventory and never evaluates the gate, emits JSON, or
        // applies --format, so a `--list --fail-on …` / `--list --json …` step
        // looks like it gates or parses but silently doesn't. Reject the
        // combination as a usage error (exit 2) rather than dropping the flag on
        // the floor.
        const ignored = [
          opts.failOn !== undefined ? "--fail-on" : null,
          opts.json ? "--json" : null,
          format !== undefined ? "--format" : null,
        ].filter((flag): flag is string => flag !== null);
        if (ignored.length > 0) {
          const flags = ignored.join(", ");
          process.stderr.write(
            `slopaudit: ${flags} cannot be combined with --list (inventory mode ` +
              `only lists files — it emits no SlopScore, no JSON and no --format ` +
              `output); drop --list to use ${flags}, or drop ${flags}\n`,
          );
          process.exitCode = 2;
          return;
        }
        await runList(path, opts);
      } else {
        await runAudit(path, { ...opts, format });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`slopaudit: ${msg}\n`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
