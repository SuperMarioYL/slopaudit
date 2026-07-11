import type { SlopFinding, SlopScore, SlopBand } from "../types.js";

/**
 * Deterministic comparator for findings: file, then line, then category.
 * Guarantees the same repo always produces the same ordered findings list.
 */
function compareFindings(a: SlopFinding, b: SlopFinding): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.line !== b.line) return a.line - b.line;
  if (a.category !== b.category) return a.category < b.category ? -1 : 1;
  // final tiebreaker on evidence so equal findings keep a stable order
  if (a.evidence !== b.evidence) return a.evidence < b.evidence ? -1 : 1;
  return 0;
}

function bandFor(score: number): SlopBand {
  if (score < 34) return "clean";
  if (score <= 66) return "moderate";
  return "heavy";
}

function clamp01(n: number): number {
  if (Number.isNaN(n) || !Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Combine weighted findings into a 0..100 SlopScore.
 *
 * Approach: slop is measured as *density* — total finding weight per line of
 * code scanned — so a small repo with a few problems isn't unfairly dwarfed by
 * a large clean one, and vice-versa. The raw density is squashed through a
 * saturating curve into 0..100 so that a handful of findings already moves the
 * needle while pathological repos asymptote toward 100.
 *
 * Fully deterministic: no Date, no random, stable-sorted findings.
 */
export function aggregate(
  findings: SlopFinding[],
  meta: {
    filesScanned: number;
    linesScanned: number;
    /**
     * Real line count per file (absolute path -> lines). When supplied, the
     * byFile heatmap is computed against each file's OWN size instead of the
     * repo average, so a small dense file correctly outranks a large file with
     * the same finding count. Optional + back-compatible: when omitted, byFile
     * falls back to the repo-average proxy (the pre-fix behavior).
     */
    linesByFile?: Record<string, number>;
  },
): SlopScore {
  const sorted = [...findings].sort(compareFindings);

  const linesScanned = Math.max(0, Math.floor(meta.linesScanned));
  const filesScanned = Math.max(0, Math.floor(meta.filesScanned));

  // Total weighted severity across the whole repo.
  let totalWeight = 0;
  for (const f of sorted) totalWeight += clamp01(f.weight);

  // Per-file weighted severity, normalized later by that file's line count.
  // We don't know per-file line counts here, so per-file density is expressed
  // relative to the repo's average lines-per-file as a stable proxy, then
  // squashed into 0..1. This keeps byFile comparable across runs.
  const perFileWeight: Record<string, number> = {};
  for (const f of sorted) {
    perFileWeight[f.file] = (perFileWeight[f.file] ?? 0) + clamp01(f.weight);
  }

  const avgLinesPerFile = filesScanned > 0 ? linesScanned / filesScanned : 0;
  const linesByFile = meta.linesByFile ?? {};

  const byFile: Record<string, number> = {};
  for (const file of Object.keys(perFileWeight).sort()) {
    const w = perFileWeight[file];
    // density = weighted findings per ~100 lines of THIS file. Prefer the file's
    // real line count (threaded through from the parser) so a small dense file
    // ranks above a large file with the same finding count; fall back to the
    // repo average only when a per-file count is unavailable. Saturating: ~1 unit
    // of weight per 100 lines ~= heavy.
    const fileLines = linesByFile[file] ?? avgLinesPerFile;
    const denom = fileLines > 0 ? fileLines / 100 : 1;
    const density = denom > 0 ? w / denom : w;
    byFile[file] = clamp01(1 - Math.exp(-density));
  }

  // Repo-wide density: weighted findings per 100 lines scanned.
  const density = linesScanned > 0 ? (totalWeight / linesScanned) * 100 : 0;

  // Saturating map density -> 0..100. k tuned so that ~1 weighted finding per
  // 100 lines lands around the moderate band, and heavier repos approach 100.
  const k = 0.7;
  const score = Math.round(100 * (1 - Math.exp(-k * density)));
  const clampedScore = Math.max(0, Math.min(100, score));

  return {
    score: clampedScore,
    band: bandFor(clampedScore),
    findings: sorted,
    byFile,
    filesScanned,
    linesScanned,
  };
}
