# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- Hosted team tier: SlopScore *history* across org repos, delta-vs-main gating, leadership dashboard.
- Additional language detectors (Python / Go / Rust) behind the existing pure-function detector seam.

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

[Unreleased]: https://github.com/SuperMarioYL/slopaudit/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/SuperMarioYL/slopaudit/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/SuperMarioYL/slopaudit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/SuperMarioYL/slopaudit/releases/tag/v0.1.0
