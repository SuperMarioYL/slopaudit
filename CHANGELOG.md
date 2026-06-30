# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- Hosted team tier: SlopScore *history* across org repos, delta-vs-main gating, leadership dashboard.
- Additional language detectors (Python / Go / Rust) behind the existing pure-function detector seam.
- Inline per-line PR annotations (the v0.3.0 Action ships the job-summary report; per-line annotations remain deferred).

## [0.3.0] - 2026-07-01

### Added
- **m5 — packaged GitHub Action:** a reusable composite Action (`action.yml`) wraps the existing `--fail-on` gate. A consuming repo adds `uses: SuperMarioYL/slopaudit-action@v0.3.0` with `fail-on:` (and optional `path:`); the job fails on a slop-over-threshold repo, and the SlopScore band + worst offenders are written to `$GITHUB_STEP_SUMMARY`. Exposes `score` / `band` step outputs. No new runtime dependency in the CLI — the Action shells out to the published CLI exactly as a user would. Inline per-line PR annotations stay deferred.
- **m6 — fourth detector (`dead_parameter`):** a new pure `(AST → SlopFinding[])` detector (`src/detectors/deadParameter.ts`) flags named function parameters that are never referenced in the body, added through the documented detector seam. It folds into the existing SlopScore with no new band and no new primitive. Conservatively skips `_`-prefixed, destructured, and rest params, and functions that read `arguments`.

### Fixed
- **Empty scan no longer reports a false-green `0/100`.** When a scan finds zero JS/TS source files (a non-existent root, a typo'd workdir, or a dir with no sources), `slopaudit` now writes a clear stderr warning and exits `2` instead of emitting a pristine `0/100` and exiting `0` — closing a false-pass in the headline CI gate. `--json` still emits the empty score (`filesScanned: 0`) first for machine consumers.
- **`--fail-on clean` / `--fail-on 0` no longer fail a flawless `0/100` repo.** The `clean` band ceiling (and numeric `0`) now means "fail on any slop at all" (`score >= 1`), so a perfectly clean `0/100` codebase passes the one threshold that previously could never pass.
- **`--list --fail-on …` no longer silently drops the gate.** `--list` only prints the inventory and never computes a SlopScore, so combining it with `--fail-on` looked like a gate but never gated. The combination is now a usage error (stderr warning, exit `2`).
- **Files using `accessor` fields are no longer skipped.** The parser now enables `decoratorAutoAccessors`, so a class using `@deco accessor x = 1` yields a non-null AST instead of throwing a non-recoverable plugin error and being silently dropped from the audit.

## [0.2.0] - 2026-06-27

### Added
- **m4 — CI fail gate:** new `--fail-on <threshold>` flag. The threshold is a band name (`clean` | `moderate` | `heavy`) or an integer `0–100`; the CLI exits `1` when the computed SlopScore meets or exceeds it, so a single workflow step can block a PR. Backed by a new pure module `src/gate/threshold.ts` (`resolveThreshold` / `gateTrips`) — no new runtime dependencies. The gate composes with `--json` (the JSON report is emitted before the gate decides the exit code); an invalid threshold exits `2`.

### Fixed
- `slopaudit --version` now reads the version from `package.json` at startup instead of a hardcoded constant in `src/cli.ts`, which had drifted from the published release. There is no longer a second place to bump on each release.

## [0.1.1] - 2026-06-19

### Changed
- Publish/packaging maintenance release; no behavioral changes to the audit.

## [0.1.0] - 2026-06-13

Initial release — a zero-config CLI that audits a JS/TS repo for AI-generated
slop debt and emits a single **SlopScore (0–100)**, 100% static, offline, and
deterministic.

### Added
- **m1 — scan & parse:** `scan/walk.ts` globs a repo for `*.{js,jsx,ts,tsx}` (skipping `node_modules` / `dist` / `build` / `vendor` / `.git`); `scan/parse.ts` parses each file to an AST via `@babel/parser` (typescript + jsx + decorators, `errorRecovery` so modern syntax never crashes the scan). `slopaudit --list` prints a file inventory with line counts.
- **m2 — score & locate:** three pure AST detectors — `over_abstraction`, `generic_boilerplate`, `plausible_but_wrong` — emit weighted `SlopFinding`s, and `score/aggregate.ts` combines them into a deterministic `SlopScore (0–100)` with bands (`clean` < 34 · `moderate` 34–66 · `heavy` > 66) and a per-file density heatmap.
- **m3 — shareable report:** `report/terminal.ts` (chalk headline + ranked top-10 offender files), `report/html.ts` (self-contained `slopaudit-report.html` heatmap, sortable, no external assets), and `report/badge.ts` (shields-style `slopaudit-badge.svg` colored by band).
- CLI flags: `--list`, `--json`, `--no-html`, `--no-badge`, `--version`, `--help`.

[Unreleased]: https://github.com/SuperMarioYL/slopaudit/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/SuperMarioYL/slopaudit/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/SuperMarioYL/slopaudit/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/SuperMarioYL/slopaudit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/SuperMarioYL/slopaudit/releases/tag/v0.1.0
