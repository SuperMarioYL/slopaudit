#!/usr/bin/env node
/**
 * Composite-Action entrypoint for SlopAudit (m5).
 *
 * Runs the published `slopaudit` CLI once in --json mode (the gate still applies
 * after the JSON is emitted), parses the SlopScore, writes the band + worst
 * offenders to $GITHUB_STEP_SUMMARY, exposes `score`/`band` as step outputs, and
 * propagates the CLI's exit code so a slop-over-threshold repo fails the job.
 *
 * No new runtime dependency in the CLI: this is an Action asset, not part of
 * src/. It shells out to `npx slopaudit` exactly as a consumer would.
 *
 * The pure helpers (resolveVersion / isEmptyScan / writeStepSummary /
 * setOutputs) are exported so vitest can pin them down without spawning npx;
 * the runnable side is wrapped in `main()` and only fires when this file is the
 * process entry point (so importing it for tests does NOT launch the CLI).
 */
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * fix-action-stale-cli-version-default: the entrypoint's own `|| "latest"`
 * fallback is defeated when action.yml sets `inputs.version.default` to a
 * pinned literal (it used to ship "0.3.0"), because then SLOPAUDIT_VERSION is
 * always non-empty. Resolve the version from the env with the same fallback so
 * a missing/blank input resolves to the current CLI. Pure + exported for tests.
 */
export function resolveVersion(env = process.env) {
  const v = (env?.SLOPAUDIT_VERSION ?? "").trim();
  return v.length > 0 ? v : "latest";
}

/**
 * fix-action-empty-scan-false-clean: the CLI's empty-scan path emits a VALID
 * `{"score":0,"band":"clean","filesScanned":0,...}` JSON to stdout and THEN
 * exits 2 (it found no JS/TS files). The previous guard only caught the
 * no-JSON case, so this real-but-empty score reached `writeStepSummary`/
 * `setOutputs` and produced a false "🟢 SlopScore: 0/100 (clean)" headline plus
 * `score=0`/`band=clean` step outputs while the job failed — the exact
 * false-clean the v0.3.0 empty-scan fix removed, relocated to the Action layer.
 * Detect it here so the summary/outputs treat it as "nothing audited".
 */
export function isEmptyScan(score) {
  return (
    !!score &&
    typeof score === "object" &&
    typeof score.filesScanned === "number" &&
    score.filesScanned === 0
  );
}

export { writeStepSummary, setOutputs, emitAnnotations };

function main() {
  const path =
    process.env.SLOPAUDIT_PATH && process.env.SLOPAUDIT_PATH.length > 0
      ? process.env.SLOPAUDIT_PATH
      : ".";
  const failOn = (process.env.SLOPAUDIT_FAIL_ON ?? "").trim();
  const version = resolveVersion();

  const args = [
    "--yes",
    `slopaudit@${version}`,
    path,
    "--json",
    "--no-html",
    "--no-badge",
  ];
  if (failOn.length > 0) {
    args.push("--fail-on", failOn);
  }

  // stdout is captured (the JSON report); stderr streams straight to the log.
  const result = spawnSync("npx", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

  if (result.error) {
    console.error(
      `slopaudit-action: failed to launch slopaudit: ${result.error.message}`,
    );
    process.exit(1);
  }

  const stdout = result.stdout ?? "";
  process.stdout.write(stdout);

  let score = null;
  try {
    const json = JSON.parse(stdout.trim());
    if (json && typeof json === "object") score = json;
  } catch {
    // The CLI may have exited before emitting JSON, OR emitted an empty-scan
    // score then exited 2 (handled by isEmptyScan downstream). Fall through with
    // score=null; the empty-scan JSON path is caught by the filesScanned check.
  }

  writeStepSummary(score, failOn, result.status);
  setOutputs(score, result.status);
  emitAnnotations(score);

  // Propagate the CLI exit code (1 = gate tripped, 2 = usage/empty-scan, 0 = pass).
  process.exit(result.status ?? 0);
}

// Only run when invoked directly (not when imported by a test).
const isMain = (() => {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    return fileURLToPath(import.meta.url) === entry;
  } catch {
    return false;
  }
})();
if (isMain) main();

// ---------------------------------------------------------------------------

/**
 * m7 — emit a GitHub Actions `::warning file=…,line=…::…` workflow command for
 * every SlopFinding in the same run that wrote the job summary, so the Action
 * surfaces per-line slop annotations inline on the PR diff with no extra setup.
 * Reads findings straight off the parsed SlopScore JSON (the CLI already carries
 * file + line + evidence on each finding); mirrors src/report/github.ts.
 */
function emitAnnotations(scoreObj) {
  if (!scoreObj || !Array.isArray(scoreObj.findings)) return;
  for (const f of scoreObj.findings) {
    if (!f || typeof f.file !== "string" || typeof f.line !== "number") continue;
    // GitHub attaches the annotation to a diff line only when `file` is relative
    // to the workspace root; the CLI reports absolute paths, so relativize
    // against cwd (= $GITHUB_WORKSPACE) and normalize to POSIX separators.
    const file = escapeProp(toWorkspacePath(f.file));
    const title = escapeProp("SlopAudit: " + String(f.category ?? "slop"));
    const message = escapeData(`${f.category ?? "slop"} — ${f.evidence ?? ""}`);
    process.stdout.write(
      `::warning file=${file},line=${f.line},title=${title}::${message}\n`,
    );
  }
}

function toWorkspacePath(file) {
  const rel = relative(process.cwd(), file);
  const chosen = rel.length > 0 && !rel.startsWith("..") ? rel : file;
  return chosen.split(sep).join("/");
}

function escapeData(s) {
  return String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function escapeProp(s) {
  return escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

/**
 * Write the SlopScore band + worst offenders to $GITHUB_STEP_SUMMARY. An empty
 * scan (filesScanned===0) or a non-numeric score is treated as "nothing
 * audited" so the summary never shows a false 0/100 (clean) badge while the
 * underlying job fails — fix-action-empty-scan-false-clean. `exitStatus` is the
 * CLI's propagated exit code (2 = empty/usage) and is honored as a tiebreaker.
 */
function writeStepSummary(score, failOnRaw, exitStatus) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return; // not running under Actions — nothing to write

  const lines = [];
  lines.push("## SlopAudit");
  lines.push("");

  // No real score: either no JSON was parsed, the score field isn't numeric,
  // or this is an empty scan (valid {score:0,band:"clean",filesScanned:0} JSON
  // then exit 2). In all three cases surface "nothing audited" instead of a
  // false clean headline.
  const nothingAudited =
    !score ||
    typeof score.score !== "number" ||
    isEmptyScan(score) ||
    exitStatus === 2;

  if (nothingAudited) {
    lines.push(
      "⚠ No SlopScore was produced — the audited path had no JS/TS source " +
        "files, or the audit failed before scoring. See the job log above.",
    );
    appendFileSync(summaryPath, lines.join("\n") + "\n");
    return;
  }

  const band = String(score.band ?? "unknown");
  const emoji = band === "clean" ? "🟢" : band === "moderate" ? "🟡" : band === "heavy" ? "🔴" : "⚪";
  lines.push(`${emoji} **SlopScore: ${score.score}/100 (${band})**`);
  lines.push("");
  lines.push(
    `${num(score.filesScanned)} files scanned · ${num(score.linesScanned)} lines · ` +
      `${num((score.findings ?? []).length)} findings`,
  );
  if (failOnRaw && failOnRaw.length > 0) {
    lines.push("");
    lines.push(`Gate: \`--fail-on ${failOnRaw}\``);
  }

  const worst = topOffenders(score.byFile, 10);
  if (worst.length > 0) {
    lines.push("");
    lines.push("### Worst offenders");
    lines.push("");
    lines.push("| File | Slop density |");
    lines.push("| --- | ---: |");
    for (const [file, density] of worst) {
      lines.push(`| \`${escapePipe(file)}\` | ${Math.round(density * 100)}% |`);
    }
  }

  lines.push("");
  lines.push("<sub>Generated by [slopaudit](https://github.com/SuperMarioYL/slopaudit) — 100% static, offline, deterministic.</sub>");

  appendFileSync(summaryPath, lines.join("\n") + "\n");
}

/**
 * Expose `score`/`band` as step outputs. Mirror the empty-scan guard from
 * writeStepSummary so a nothing-audited run does not emit `score=0` /
 * `band=clean` (downstream steps would read a false pristine score).
 */
function setOutputs(score, exitStatus) {
  const outPath = process.env.GITHUB_OUTPUT;
  if (!outPath) return;
  const nothingAudited =
    !score ||
    typeof score.score !== "number" ||
    isEmptyScan(score) ||
    exitStatus === 2;
  const scoreVal = nothingAudited ? "" : String(score.score);
  const bandVal = nothingAudited
    ? ""
    : typeof score.band === "string"
      ? score.band
      : "";
  appendFileSync(outPath, `score=${scoreVal}\nband=${bandVal}\n`);
}

function topOffenders(byFile, n) {
  if (!byFile || typeof byFile !== "object") return [];
  return Object.entries(byFile)
    .filter(([, d]) => typeof d === "number")
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, n);
}

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? String(v) : "0";
}

function escapePipe(s) {
  return String(s).replace(/\|/g, "\\|");
}
