# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- Hosted team tier: SlopScore *history* across org repos, delta-vs-main gating, leadership dashboard.
- Additional language detectors (Python / Go / Rust) behind the existing pure-function detector seam.

## [0.7.0] - 2026-07-23

Correctness / false-positive release. Four revert-verified fixes from a source
audit of the shipped v0.6.0 detectors, the packaged Action, and the license
file — no new detector, ecosystem, or CLI surface. Each fix is guarded by a
regression test that fails on the reverted hunk (bug/false-positive returns)
and passes once the fix is restored.

### Fixed
- **The packaged Action runs the current CLI, not a hardcoded
  `slopaudit@0.3.0`.** The composite Action's `version` input defaulted to
  `"0.3.0"` (`action.yml`), so `SLOPAUDIT_VERSION` was always non-empty and the
  entrypoint's own `|| "latest"` fallback never fired — the v0.6.0 Action
  silently ran `npx slopaudit@0.3.0`, missing the `copy_paste_clone` detector
  (v0.4.0) and every correctness fix shipped v0.4.0–v0.6.0, including the
  unreachable-after-hoisted-decl fix that is this release's headline. The input
  default is now `"latest"` so the entrypoint resolves to the current CLI when
  no version is pinned. (`action.yml`, `scripts/action-entrypoint.mjs`)
- **The Action no longer reports a pristine 0/100 (clean) summary + outputs for
  an empty/failed scan.** The `writeStepSummary` guard only caught the no-JSON
  case, but the CLI's empty-scan path emits a valid
  `{"score":0,"band":"clean","filesScanned":0}` JSON to stdout and then exits 2,
  so the Action parsed a real score and wrote a "🟢 SlopScore: 0/100 (clean)"
  headline to `$GITHUB_STEP_SUMMARY` plus `score=0`/`band=clean` step outputs
  while the job failed — the exact false-clean the v0.3.0 empty-scan fix
  removed, relocated to the Action layer. `writeStepSummary` and `setOutputs`
  now treat an empty scan (`filesScanned === 0` or exit 2) as "nothing audited"
  and emit the no-score message / empty outputs instead.
  (`scripts/action-entrypoint.mjs`)
- **The `x !== x` NaN-check idiom is no longer flagged as dead code.**
  `constantTest` treated any `BinaryExpression` with the same identifier on
  both sides as constant, so `if (x !== x) { ... }` — the standard
  pre-`Number.isNaN` NaN-detection idiom — was reported "guard condition is
  always false — branch is dead code". The branch is NOT dead: it runs when `x`
  is NaN. Same-operand `===`/`==`/`!==`/`!=` are now exempt (NaN makes none of
  them truly constant), so the idiom is no longer reported as dead code.
  (`src/detectors/plausibleButWrong.ts`)
- **Unawaited calls inside a SYNC function nested in an async function are no
  longer mis-flagged.** `inAsync` used `ancestors.some(... .async)`, so a sync
  function nested inside an async one was treated as async; a bare call inside
  the sync helper was flagged "returns a promise but is not awaited inside an
  async function" though `await` is a syntax error there — the finding's implied
  remedy was impossible. The nearest enclosing function now governs async-ness
  (a sync function inside an async one is not async), so calls in sync nested
  functions are no longer mis-attributed to an outer async function.
  (`src/detectors/plausibleButWrong.ts`)

### Changed
- Filled the Apache-2.0 LICENSE copyright placeholder
  (`Copyright 2026 SuperMarioYL`) and confirmed the README license prose is
  Apache-2.0 end-to-end (badge, footer, copy).

## [0.6.0] - 2026-07-14

Correctness release. Two false-negative fixes from a source audit of the shipped
v0.5.0 detectors and reporters — no new detector, ecosystem, or CLI surface.

### Fixed
- **GitHub PR annotations now attach to the diff.** The `--format github` emitter
  (`src/report/github.ts`) and the packaged Action's entrypoint
  (`scripts/action-entrypoint.mjs`) emitted each `::warning file=…` workflow
  command with the scanner's *absolute* file path. GitHub only attaches an
  annotation to a line of the PR diff when `file` is a path relative to the
  workspace root, so every inline slop annotation — the whole point of the v0.4.0
  m7 feature — was silently dropped from the diff. Finding paths are now
  relativized to the working directory (the workspace root under Actions) and
  normalized to POSIX separators. Guarded by a regression test.
- **Unreachable code after a hoisted declaration is no longer missed.** The
  unreachable-code check in `src/detectors/plausibleButWrong.ts` stopped scanning
  at the first hoisted declaration following a terminating statement, so a block
  like `return; function helper() {} ; runDeadCode();` left the genuinely
  unreachable `runDeadCode()` unflagged (a silent false negative on a category the
  README advertises). The scan now skips past hoisted declarations
  (function/var/class/type) and reports the first truly-dead statement after the
  terminator. Guarded by regression tests.

## [0.5.0] - 2026-07-11

Correctness release. Two precision/accuracy fixes from a source audit of the
shipped v0.4.0 detectors — no new detector, ecosystem, or CLI surface.

### Fixed
- **`dead_parameter` no longer false-flags a parameter used only in the function
  signature** (`src/detectors/deadParameter.ts`). The detector searched only the
  function *body* for a reference, so a parameter used solely in a later
  parameter's default initializer (`function f(a, b = a)`) or in a type position
  (a parameter/return type such as `function g(x): typeof x`) was reported as a
  dead parameter even though it is genuinely used. For a slop linter a false
  positive erodes trust in the whole score, so the reference search now also
  covers sibling parameters' default values, parameter type annotations, and the
  return type — never a parameter's own binding — so a signature-only use counts.
  Genuinely dead parameters are still flagged. Guarded by regression tests.
- **`byFile` heatmap now ranks by each file's real slop density**
  (`src/score/aggregate.ts`, `src/cli.ts`). The per-file "worst offenders"
  density used the *repo-average* lines-per-file for every file, so a 5-line file
  with one finding and a 200-line file with one finding received an identical
  density — misranking the headline heatmap. The real per-file line counts (which
  the parser already computes) are now threaded into `aggregate`, so a small dense
  file correctly outranks a large file with the same finding count. The change is
  backward-compatible: when per-file counts are absent the previous repo-average
  proxy is used. Guarded by a regression test.

## [0.4.0] - 2026-07-04

Growth-wedge + detector-seam release. No new primitive and no new SlopScore band —
two in-seam feature milestones the v0.3.0 plan named as the next steps.

### Added
- **m7 — inline per-line PR annotations.** A new `--format github` CLI mode emits a
  GitHub Actions `::warning file=…,line=…::…` workflow command for every
  `SlopFinding` (pure formatter over the existing score — every finding already
  carries file + line + evidence; property values and messages are escaped per the
  workflow-command spec). The packaged Action now drops these per-line slop
  annotations onto the PR diff automatically, from the same run that writes the job
  summary — no extra setup. Retires the "inline annotations deferred" note.
- **m8 — fifth detector `copy_paste_clone`.** A near-duplicate-block detector added
  through the same pure `AST -> SlopFinding[]` seam. It is the *fuzzy* complement to
  `generic_boilerplate`'s exact duplicate-block check: it fingerprints each statement
  structurally (identifier names + literal values ignored) and flags a block whose
  statement multiset overlaps an earlier block by ≥75% (Dice) while **excluding
  exact-ordered clones** — so it catches reordered / lightly-edited copies the exact
  matcher slides past, without double-counting what `generic_boilerplate` already
  flags. Folds into the existing SlopScore with no new band.

### Changed
- `package.json` version → `0.4.0`.
- `out_of_scope` no longer defers inline per-line PR annotations (shipped in m7).

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

[Unreleased]: https://github.com/SuperMarioYL/slopaudit/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/SuperMarioYL/slopaudit/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/SuperMarioYL/slopaudit/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/SuperMarioYL/slopaudit/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/SuperMarioYL/slopaudit/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/SuperMarioYL/slopaudit/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/SuperMarioYL/slopaudit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/SuperMarioYL/slopaudit/releases/tag/v0.1.0
