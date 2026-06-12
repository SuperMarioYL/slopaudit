# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- Hosted team tier: SlopScore history across org repos, CI gating, leadership dashboard.
- Additional language detectors (Python / Go / Rust) behind the existing pure-function detector seam.

## [0.1.0] - 2026-06-13

Initial release — a zero-config CLI that audits a JS/TS repo for AI-generated
slop debt and emits a single **SlopScore (0–100)**, 100% static, offline, and
deterministic.

### Added
- **m1 — scan & parse:** `scan/walk.ts` globs a repo for `*.{js,jsx,ts,tsx}` (skipping `node_modules` / `dist` / `build` / `vendor` / `.git`); `scan/parse.ts` parses each file to an AST via `@babel/parser` (typescript + jsx + decorators, `errorRecovery` so modern syntax never crashes the scan). `slopaudit --list` prints a file inventory with line counts.
- **m2 — score & locate:** three pure AST detectors — `over_abstraction`, `generic_boilerplate`, `plausible_but_wrong` — emit weighted `SlopFinding`s, and `score/aggregate.ts` combines them into a deterministic `SlopScore (0–100)` with bands (`clean` < 34 · `moderate` 34–66 · `heavy` > 66) and a per-file density heatmap.
- **m3 — shareable report:** `report/terminal.ts` (chalk headline + ranked top-10 offender files), `report/html.ts` (self-contained `slopaudit-report.html` heatmap, sortable, no external assets), and `report/badge.ts` (shields-style `slopaudit-badge.svg` colored by band).
- CLI flags: `--list`, `--json`, `--no-html`, `--no-badge`, `--version`, `--help`.

[Unreleased]: https://github.com/SuperMarioYL/slopaudit/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/SuperMarioYL/slopaudit/releases/tag/v0.1.0
