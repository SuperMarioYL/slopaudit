<!-- Language: English · 中文版 → [README.zh-CN.md](./README.zh-CN.md) -->

<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:e05d44,50:dfb317,100:4c1&height=190&section=header&text=SlopAudit&fontSize=58&fontColor=ffffff&fontAlignY=38&desc=Score%20the%20AI%20slop%20your%20agents%20left%20behind&descSize=18&descAlignY=60" alt="SlopAudit" />
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License: Apache-2.0" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white" alt="Node >= 22" />
  <a href="https://www.npmjs.com/package/slopaudit"><img src="https://img.shields.io/npm/v/slopaudit.svg?color=cb3837&logo=npm" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs welcome" />
  <img src="https://img.shields.io/badge/built%20with-TypeScript-3178c6?logo=typescript&logoColor=white" alt="Built with TypeScript" />
</p>

<p align="center">
  <b>Your AI coding agents wrote half of it. Now you maintain it. <br/>SlopAudit tells you how bad it is — and exactly where.</b>
</p>

<p align="center">
  <img src="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&size=22&duration=3000&pause=900&color=E05D44&center=true&vCenter=true&width=620&lines=SlopScore%3A+71%2F100+(heavy);Zero+config.+Offline.+Deterministic.;npx+slopaudit+." alt="typing" />
</p>

---

## Table of contents

- [What is SlopAudit?](#what-is-slopaudit)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Demo](#demo)
- [How it works](#how-it-works)
- [The slop categories](#the-slop-categories)
- [CLI usage](#cli-usage)
- [GitHub Action](#github-action)
- [The SlopScore badge (viral loop)](#the-slopscore-badge)
- [Pricing](#pricing)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## What is SlopAudit?

AI coding **agents** ship code fast — and a growing share of every JS/TS repo is now generated, half-reviewed, and inherited by a human who didn't write it. Agent **Skills**, prompt configs, and copy-pasted scaffolds (see ecosystems like [`Shubhamsaboo/awesome-llm-apps`](https://github.com/Shubhamsaboo/awesome-llm-apps) and [`affaan-m/everything-claude-code`](https://github.com/affaan-m/everything-claude-code)) accumulate a specific kind of debt that linters never flag: **slop**.

SlopAudit is a **zero-config CLI** that audits an existing JS/TS repo for AI-generated slop debt and emits a single headline number — the **SlopScore (0–100)** — plus a ranked file heatmap and a shareable report.

> **SlopScore** answers the question ESLint and SonarQube cannot: *"How much AI-generated slop am I now maintaining, and where is it?"*

It is **100% static and heuristic** — no LLM calls, no network, no telemetry. The same repo produces the same score on every run.

| | |
|---|---|
| **Higher SlopScore** | more AI-slop debt (`heavy`) |
| **Lower SlopScore** | cleaner, intentional code (`clean`) |
| **Bands** | `clean` < 34 · `moderate` 34–66 · `heavy` > 66 |

---

## <img src="https://api.iconify.design/tabler:topology-star-3.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> Architecture

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/atlas-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="./assets/atlas-light.svg">
    <img src="./assets/atlas-light.svg" width="880" alt="SlopAudit data flow: the CLI walks and parses a JS/TS repo to ASTs, runs three pure AST detectors, aggregates findings into a deterministic SlopScore (0–100), then renders a terminal report, HTML heatmap and SVG badge — all offline.">
  </picture>
</p>

One command walks the repo (`scan/walk.ts`) and parses every JS/TS file to an AST (`scan/parse.ts`, `errorRecovery` so modern syntax never crashes the scan). Four **pure detectors** — `over_abstraction`, `generic_boilerplate`, `plausible_but_wrong`, and `dead_parameter` — turn that AST into weighted `SlopFinding`s, which `score/aggregate.ts` normalizes into one deterministic **SlopScore (0–100)**. The `report/` layer renders the same score three ways: a chalk terminal heatmap, a self-contained HTML report, and a shields-style SVG badge. The whole pipeline is static and offline — no LLM, no network, same repo → same score. In CI, the same gate ships as a packaged **GitHub Action** that writes the score to the job summary.

---

## Quick start

No install. One command in any JS/TS repo:

```bash
npx slopaudit .
```

You get a terminal summary, a self-contained `slopaudit-report.html` heatmap, and a `slopaudit-badge.svg` — written to your current directory in under two minutes.

```text
SlopScore: 71/100 (heavy)
124 files scanned · 18452 lines · 213 findings

Top offender files
 1. src/services/AbstractFactoryProvider.ts  ████████████████░░░░   82%
 2. src/utils/genericHandlerWrapper.ts       ██████████████░░░░░░   71%
 3. src/managers/ConfigManagerManager.ts     █████████████░░░░░░░   64%
 4. src/core/BasePassthroughService.ts        ███████████░░░░░░░░░   58%
 5. src/handlers/maybeTryCatchHandler.ts      ██████████░░░░░░░░░░   51%
 ...

Wrote slopaudit-report.html, slopaudit-badge.svg
```

Open `slopaudit-report.html` in any browser — it's fully self-contained (inline CSS, sortable file table, color-coded heatmap, no server, no external assets) and safe to send to your team.

---

## <img src="https://api.iconify.design/tabler:photo.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> Demo

<p align="center">
  <img src="./assets/demo.gif" alt="slopaudit audits a repo: SlopScore headline, ranked offender-file heatmap, then writes the HTML report and SVG badge" width="820" />
</p>

<sub>↑ Terminal recording (rendered in CI with <a href="https://github.com/charmbracelet/vhs">vhs</a> from <a href="./docs/demo.tape">docs/demo.tape</a>, regenerated on each tag).</sub>

---

## How it works

```
npx slopaudit .
      │
      ▼
 scan/walk.ts     fast-glob the repo for *.{js,jsx,ts,tsx},
                  skipping node_modules / dist / build / vendor / .git
      │
      ▼
 scan/parse.ts    @babel/parser → AST per file
                  (typescript + jsx + decorators, errorRecovery so
                   modern syntax never crashes the scan)
      │
      ▼
 detectors/       four pure AST detectors → SlopFinding[]
   ├─ overAbstraction.ts
   ├─ genericBoilerplate.ts
   ├─ plausibleButWrong.ts
   └─ deadParameter.ts
      │
      ▼
 score/aggregate.ts   SlopFinding[] → SlopScore (weighted density,
                       normalized 0..100, banded, deterministic)
      │
      ▼
 report/          terminal.ts (chalk)  ·  html.ts (heatmap)  ·  badge.ts (SVG)
      │
      ▼
 action.yml       composite GitHub Action → runs the --fail-on gate in CI,
                  writes band + worst files to $GITHUB_STEP_SUMMARY
```

Each detector is a **pure function** (`AST → SlopFinding[]`), independently unit-tested. That seam is where future categories and languages plug in. Every finding carries human-readable **evidence** (e.g. `"4-deep wrapper, single caller"`) — SlopAudit is a triage instrument you can verify, not a black-box verdict.

---

## The slop categories

SlopAudit scores an **AI-specific axis** — not style, not correctness, but the patterns agents over-produce:

| Category | What it catches | Example evidence |
|---|---|---|
| **`over_abstraction`** | Deep single-caller wrapper chains, needless factory/provider/manager layers, one-method interfaces, pass-through functions | `4-deep wrapper, single caller` |
| **`generic_boilerplate`** | Near-duplicate scaffold blocks, copy-paste try/catch, trivial getters/setters en masse, TODO/placeholder comment density | `near-identical scaffold ×6` |
| **`plausible_but_wrong`** | Empty catches that swallow errors, `any`-heavy signatures, unawaited promises, dead branches, contradictory guards | `empty catch swallows error` |
| **`dead_parameter`** *(new in v0.3.0)* | Named function parameters wired into a signature but never read in the body — the `context`/`options` an agent added "just in case" | `parameter "ctx" is never used` |

This is lint-clean slop: code that passes ESLint and compiles fine, but is the debt a human now has to untangle.

---

## CLI usage

```bash
slopaudit [path]            # full audit (default path ".")
```

| Flag | Effect |
|---|---|
| *(none)* | Full audit: terminal report + writes `slopaudit-report.html` and `slopaudit-badge.svg` to cwd |
| `--list` | **m1 inventory only** — list every source file with line counts, no scoring |
| `--json` | Print the `SlopScore` as JSON to stdout (machine-readable, ideal for CI) |
| `--fail-on <threshold>` | **CI gate** — exit non-zero when the SlopScore meets/exceeds `<threshold>` (a band `clean`/`moderate`/`heavy`, or an integer `0–100`) |
| `--no-html` | Skip writing `slopaudit-report.html` |
| `--no-badge` | Skip writing `slopaudit-badge.svg` |
| `-v, --version` | Print the version |
| `-h, --help` | Show help |

Examples:

```bash
npx slopaudit ./packages/api        # audit a sub-package
npx slopaudit . --json              # SlopScore as JSON to stdout (files still written)
npx slopaudit . --json --no-html --no-badge   # pure stdout, nothing written — CI friendly
npx slopaudit . --list              # file inventory + line counts only
npx slopaudit . --fail-on moderate  # exit 1 if the repo is moderate-or-heavy (CI gate)
npx slopaudit . --fail-on 50        # exit 1 if SlopScore >= 50
```

### Gate it in CI

`--fail-on` turns the SlopScore into a pull-request gate — one step, no service, no account. The CLI exits `1` when the score crosses your threshold, so the job fails:

```yaml
# .github/workflows/slop.yml
- name: SlopAudit gate
  run: npx slopaudit . --fail-on moderate --no-html --no-badge
```

`--fail-on` composes with `--json`: the JSON report is still written to stdout before the gate decides the exit code, so you can both publish the score and block the PR in one run.

---

## GitHub Action

*New in v0.3.0.* For GitHub repos, the same gate ships as a **packaged, reusable composite Action** — no `npx` boilerplate, and the SlopScore band + worst offenders are written straight to the **job summary**. Drop it into any workflow:

```yaml
# .github/workflows/slop.yml
name: SlopAudit
on: [pull_request]
jobs:
  slopaudit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: SuperMarioYL/slopaudit-action@v0.3.0
        with:
          path: "."          # directory to audit (default ".")
          fail-on: moderate   # band clean|moderate|heavy, or an integer 0–100
```

| Input | Default | Effect |
|---|---|---|
| `path` | `.` | Directory to audit, relative to the workspace |
| `fail-on` | *(empty)* | Threshold that fails the job (band or `0–100`). Leave empty to report the score in the summary **without** failing the build |
| `version` | `0.3.0` | npm version/tag of `slopaudit` the Action runs |

The job **fails** when the SlopScore meets or exceeds `fail-on`, and the run's **Summary** tab shows the band, the file counts, and a ranked "worst offenders" table — no inline-annotation setup required. The Action also exposes `score` and `band` as step outputs:

```yaml
      - uses: SuperMarioYL/slopaudit-action@v0.3.0
        id: slop
        with:
          fail-on: heavy
      - run: echo "SlopScore is ${{ steps.slop.outputs.score }} (${{ steps.slop.outputs.band }})"
```

> The Action is a thin composite wrapper around the same CLI gate — still 100% static, offline, and deterministic. Inline per-line PR annotations remain on the roadmap; v0.3.0 ships the Action + job-summary report.

---

## The SlopScore badge

Every run writes `slopaudit-badge.svg` — a shields-style flat badge colored by band (green `clean` / yellow `moderate` / red `heavy`). **Commit it and add it to your README:**

```md
![SlopScore](./slopaudit-badge.svg)
```

That badge is the loop: each `SlopScore: 23/100` someone pastes is a public signal that their repo has been audited — and a link back. Wear a low score with pride; treat a high one as a to-do list.

---

## Pricing

**The CLI is free, open source (Apache-2.0), and stays that way for individuals and OSS projects.** Run it as often as you like, offline, with zero accounts.

For teams that need to *watch* the score rather than spot-check it, a **hosted team tier** is on the roadmap:

| | **OSS CLI** | **Team (hosted) — coming soon** |
|---|---|---|
| `npx slopaudit .` audits | Unlimited | Unlimited |
| HTML heatmap + SVG badge | ✓ | ✓ |
| Offline / deterministic | ✓ | ✓ |
| **Gate a PR in CI** on an absolute threshold (`--fail-on` / packaged Action) | ✓ | ✓ |
| SlopScore **history / trend across all org repos** | — | ✓ |
| Gate on a *rising* score (delta vs. main, not just absolute) | — | ✓ |
| Dashboard to forward to leadership | — | ✓ |
| Pricing | **Free** | **~$15 / active dev / month** |

The free CLI proves the score is credible — and as of v0.3.0 it gates CI on an absolute threshold via a one-line **GitHub Action** (`--fail-on`) on its own. The team tier adds what a single CLI run can't: *history* — tracking the score over time across an org's repos and failing a PR that *raises* slop debt relative to main. Inbound "can we get the hosted history tier?" requests are welcome via [Issues](https://github.com/SuperMarioYL/slopaudit/issues).

---

## Roadmap

- [x] **m1 — scan & parse:** walk a repo, parse every JS/TS file to an AST (TSX, decorators, modern syntax) without crashing, emit a `--list` inventory.
- [x] **m2 — score & locate:** three slop detectors → weighted `SlopFinding`s → a deterministic `SlopScore (0–100)` + ranked per-file heatmap.
- [x] **m3 — shareable report:** chalk terminal summary, self-contained HTML heatmap, and the SVG SlopScore badge.
- [x] **m4 — CI fail gate:** `--fail-on <band|score>` exits non-zero when the SlopScore crosses a threshold, so a PR can be blocked with one workflow step.
- [x] **m5 — GitHub Action:** packaged composite Action wrapping `--fail-on`, writing the band + worst offenders to the job summary (`uses: SuperMarioYL/slopaudit-action@v0.3.0`).
- [x] **m6 — fourth detector:** `dead_parameter` (unused function parameters) through the pure-function detector seam.
- [ ] **Inline PR annotations:** per-line review comments on the worst offenders (the Action ships the job-summary report first).
- [ ] **Hosted team tier:** SlopScore *history* across org repos + delta-vs-main gating + leadership dashboard.
- [ ] **More languages:** Python / Go / Rust detectors behind the same pure-function detector seam.
- [ ] **More detectors:** community-contributed slop categories.

---

## Contributing

PRs welcome. Detectors are pure functions (`AST → SlopFinding[]`) with their own unit tests — the easiest, highest-leverage place to contribute is a new detector or a sharper heuristic for an existing one.

```bash
git clone https://github.com/SuperMarioYL/slopaudit.git
cd slopaudit
npm install
npm run build
npm test
node dist/cli.js .
```

Open an issue first for anything large so we can agree on the slop axis it measures. Keep detectors **deterministic** — no `Date`, no random, same repo → same score.

---

## License

[Apache-2.0](./LICENSE).
