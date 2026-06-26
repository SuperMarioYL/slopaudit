import type { SlopScore, SlopBand } from "../types.js";

/**
 * CI fail-gate threshold resolution (m4).
 *
 * `--fail-on <threshold>` lets a CI job block a PR when a repo's SlopScore is too
 * high. The threshold is either a band name (`clean` | `moderate` | `heavy`) or a
 * raw integer 0..100. We resolve it to a numeric *ceiling* — the lowest score that
 * trips the gate — and a finding crosses the gate when `score >= ceiling`.
 *
 * Band ceilings mirror `aggregate.ts`'s `bandFor`: clean < 34, moderate 34..66,
 * heavy > 66. So the lower bound (= the ceiling that "fail on this band or worse")
 * is clean = 0, moderate = 34, heavy = 67. `--fail-on moderate` therefore trips on
 * any moderate-or-heavy repo; `--fail-on heavy` only on heavy.
 *
 * Pure + deterministic: no I/O, no Date, no globals. Trivially unit-testable.
 */

/** Lowest score (inclusive) that belongs to each band — the band's gate ceiling. */
const BAND_CEILING: Record<SlopBand, number> = {
  clean: 0,
  moderate: 34,
  heavy: 67,
};

export class InvalidThresholdError extends Error {
  constructor(raw: string) {
    super(
      `invalid --fail-on threshold "${raw}": expected a band ` +
        `(clean|moderate|heavy) or an integer 0-100`,
    );
    this.name = "InvalidThresholdError";
  }
}

function isBand(value: string): value is SlopBand {
  return value === "clean" || value === "moderate" || value === "heavy";
}

/**
 * Resolve a `--fail-on` argument into the numeric ceiling at/above which the gate
 * trips. Throws `InvalidThresholdError` on anything that is neither a known band
 * nor an integer in 0..100.
 */
export function resolveThreshold(raw: string): number {
  const normalized = raw.trim().toLowerCase();
  if (normalized.length === 0) throw new InvalidThresholdError(raw);

  if (isBand(normalized)) return BAND_CEILING[normalized];

  // Numeric path: require a plain integer 0..100 (reject "12.5", "1e2", "0x10", "  ").
  if (!/^\d+$/.test(normalized)) throw new InvalidThresholdError(raw);
  const n = Number.parseInt(normalized, 10);
  if (!Number.isInteger(n) || n < 0 || n > 100) throw new InvalidThresholdError(raw);
  return n;
}

/**
 * Decide whether a computed SlopScore trips the gate for the given threshold.
 * Returns `true` when the CI job should fail (exit 1).
 */
export function gateTrips(score: SlopScore, threshold: string): boolean {
  const ceiling = resolveThreshold(threshold);
  return score.score >= ceiling;
}
