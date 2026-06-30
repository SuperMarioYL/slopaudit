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
 * is moderate = 34, heavy = 67. `--fail-on moderate` therefore trips on any
 * moderate-or-heavy repo; `--fail-on heavy` only on heavy.
 *
 * The `clean` band's true lower bound is 0, but a ceiling of 0 would make
 * `--fail-on clean` (and numeric `--fail-on 0`) trip on *every* score including a
 * perfectly clean 0/100 repo — the one threshold that can never pass. That is a
 * false red on a flawless codebase, so we treat the `clean` ceiling as 1: it means
 * "fail on any slop at all" (score >= 1), and a literal 0/100 passes. Numeric
 * `--fail-on 0` is given the same "fail on any slop, 0 passes" meaning.
 *
 * Pure + deterministic: no I/O, no Date, no globals. Trivially unit-testable.
 */

/**
 * Lowest score (inclusive) that trips the gate for each band — the band's gate
 * ceiling. `clean` is 1 (not 0) so a pristine 0/100 repo passes `--fail-on clean`;
 * see the module comment.
 */
const BAND_CEILING: Record<SlopBand, number> = {
  clean: 1,
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
  // `--fail-on 0` means "fail on any slop" (ceiling 1) so a literal 0/100 passes —
  // mirrors the `clean` band; every other integer is its own ceiling.
  return n === 0 ? 1 : n;
}

/**
 * Decide whether a computed SlopScore trips the gate for the given threshold.
 * Returns `true` when the CI job should fail (exit 1).
 */
export function gateTrips(score: SlopScore, threshold: string): boolean {
  const ceiling = resolveThreshold(threshold);
  return score.score >= ceiling;
}
