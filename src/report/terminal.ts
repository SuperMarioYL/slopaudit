import chalk from "chalk";
import type { ChalkInstance } from "chalk";
import type { SlopScore, SlopBand } from "../types.js";

function bandColor(band: SlopBand): ChalkInstance {
  switch (band) {
    case "clean":
      return chalk.green;
    case "moderate":
      return chalk.yellow;
    case "heavy":
      return chalk.red;
  }
}

function densityColor(density: number): ChalkInstance {
  if (density < 0.34) return chalk.green;
  if (density <= 0.66) return chalk.yellow;
  return chalk.red;
}

/**
 * Render a fixed-width density bar (0..1 -> filled blocks out of `width`).
 */
function bar(density: number, width = 20): string {
  const d = Math.max(0, Math.min(1, density));
  const filled = Math.round(d * width);
  const empty = width - filled;
  const color = densityColor(d);
  return color("█".repeat(filled)) + chalk.gray("░".repeat(empty));
}

/**
 * Full terminal report: headline SlopScore, repo meta, and a ranked top-10
 * offender file list with per-file density bars.
 */
export function renderTerminal(score: SlopScore): string {
  const color = bandColor(score.band);
  const lines: string[] = [];

  lines.push("");
  lines.push(
    color.bold(`SlopScore: ${score.score}/100 (${score.band})`),
  );
  lines.push(
    chalk.gray(
      `${score.filesScanned} files scanned · ${score.linesScanned} lines · ${score.findings.length} findings`,
    ),
  );
  lines.push("");

  const ranked = Object.entries(score.byFile)
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    })
    .slice(0, 10);

  if (ranked.length === 0) {
    lines.push(chalk.green("No slop detected. Nice."));
    lines.push("");
    return lines.join("\n");
  }

  lines.push(chalk.bold("Top offender files"));
  const longest = ranked.reduce((m, [f]) => Math.max(m, f.length), 0);
  const nameWidth = Math.min(longest, 60);

  ranked.forEach(([file, density], i) => {
    const rank = chalk.gray(`${String(i + 1).padStart(2, " ")}.`);
    const display =
      file.length > nameWidth ? "…" + file.slice(file.length - nameWidth + 1) : file;
    const padded = display.padEnd(nameWidth, " ");
    const pct = `${Math.round(density * 100)}%`.padStart(4, " ");
    lines.push(`${rank} ${padded}  ${bar(density)}  ${densityColor(density)(pct)}`);
  });

  lines.push("");
  return lines.join("\n");
}

/**
 * `--list` (m1) inventory output: one line per source unit with its line count,
 * sorted by descending line count then path. No scoring.
 */
export function renderInventory(units: { file: string; lineCount: number }[]): string {
  const lines: string[] = [];
  const sorted = [...units].sort((a, b) => {
    if (b.lineCount !== a.lineCount) return b.lineCount - a.lineCount;
    return a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
  });

  const total = sorted.reduce((s, u) => s + u.lineCount, 0);
  lines.push("");
  lines.push(chalk.bold(`Inventory: ${sorted.length} files · ${total} lines`));
  lines.push("");

  const longest = sorted.reduce((m, u) => Math.max(m, u.file.length), 0);
  const nameWidth = Math.min(longest, 70);

  for (const u of sorted) {
    const display =
      u.file.length > nameWidth
        ? "…" + u.file.slice(u.file.length - nameWidth + 1)
        : u.file;
    const padded = display.padEnd(nameWidth, " ");
    lines.push(`${padded}  ${chalk.cyan(String(u.lineCount).padStart(6, " "))}`);
  }

  lines.push("");
  return lines.join("\n");
}
