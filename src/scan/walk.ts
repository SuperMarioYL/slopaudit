import fg from "fast-glob";
import path from "node:path";

/**
 * Recursively collect source files under `root`.
 *
 * Matches **\/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}, ignoring dependency, build, and common
 * generated directories plus minified bundles. Returns absolute paths sorted
 * lexicographically so the same tree always yields the same order (the rest of
 * the pipeline depends on this determinism).
 *
 * fix-walk-misses-mjs-cjs-mts-cts-under-audit: the four ESM/CJS/TS-variant
 * extensions (.mjs/.cjs Node modules, .mts/.cts TS variants) are real JS/TS
 * source that modern repos use for config + package entry points, so they are
 * globbed here too — otherwise a repo whose only slop lives in a .mjs/.cjs
 * file would score 0/100 (clean) and silently pass --fail-on (a false green in
 * the headline CI gate). parseFile already handles them: .mts/.cts via the
 * existing "typescript" plugin and .mjs/.cjs via sourceType:"module" +
 * allowReturnOutsideFunction, so no parser change was needed.
 *
 * feat-ignore-user-globs: `extraIgnores` lets a user append repo-specific
 * globs (e.g. "examples/**", "bench/**", a custom outDir) the built-in ignore
 * list misses, so those dirs are not collected and audited as executable
 * source (which would emit noise findings on example/generated code and
 * inflate linesScanned — the same score-distortion shape the v0.9-v0.11 fixes
 * removed for the built-in dirs). fast-glob already merges the array, so no
 * new runtime dep is needed; `extraIgnores` defaults to `[]` so `walk(root)`
 * stays back-compatible with every existing caller and test.
 */
export async function walk(root: string, extraIgnores: string[] = []): Promise<string[]> {
  const cwd = path.resolve(root);

  const entries = await fg("**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}", {
    cwd,
    absolute: true,
    onlyFiles: true,
    // fix-walk-dotfalse-skips-dotfile-configs: fast-glob's `dot` flag is blunt —
    // `dot: false` skipped dot-DIRECTORIES but also dot-FILES that are real JS/TS
    // source config (`.eslintrc.cjs`, `.babelrc.js`, `.swcrc`), silently dropping
    // them from the audit so a repo whose only slop lived in a dotfile config
    // scored 0/100 (clean) and PASSED `--fail-on` (a false green in the headline
    // CI gate). The `ignore` array below already excludes `**/.git/**`,
    // `**/.next/**`, etc., and fast-glob matches `ignore` regardless of `dot`, so
    // `.git`/`node_modules` stay excluded. `dot: true` re-includes only real
    // dotfile source configs.
    dot: true,
    followSymbolicLinks: false,
    suppressErrors: true,
    ignore: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/out/**",
      "**/coverage/**",
      "**/.git/**",
      "**/vendor/**",
      // common generated / cache dirs
      "**/.next/**",
      "**/.nuxt/**",
      "**/.svelte-kit/**",
      "**/.turbo/**",
      "**/.cache/**",
      "**/.parcel-cache/**",
      "**/.vercel/**",
      "**/.output/**",
      "**/.angular/**",
      "**/.expo/**",
      "**/__generated__/**",
      "**/generated/**",
      "**/storybook-static/**",
      // minified / map bundles
      "**/*.min.js",
      "**/*.min.jsx",
      "**/*.bundle.js",
      // fix-walk-min-mjs-cjs-mts-cts-not-excluded: the v0.9.0 glob addition of
      // .mjs/.cjs/.mts/.cts introduced minified ESM/CJS/TS-variant bundle variants
      // (e.g. `lib.min.mjs`, `vendor.min.cjs`, `bundle.min.mts`) that the old
      // .min.js/.min.jsx/.bundle.js ignore arms did NOT cover, so minified
      // ESM/CJS bundles committed outside the ignored build dirs were collected
      // and audited as executable source — emitting noise findings on dense
      // repeated tokens and inflating linesScanned, diluting the per-100-lines
      // density and dragging the SlopScore down into a false-clean PASS (the same
      // score-distortion defect class as the v0.10.0 .d.mts/.d.cts fix). Mirror
      // the existing .min.js / .bundle.js intent across the ESM/CJS/TS variants.
      "**/*.min.mjs",
      "**/*.min.cjs",
      "**/*.min.mts",
      "**/*.min.cts",
      "**/*.bundle.mjs",
      "**/*.bundle.cjs",
      "**/*.bundle.ts",
      "**/*.bundle.mts",
      "**/*.bundle.cts",
      "**/*.d.ts",
      // TypeScript ESM/CJS declaration files — the declaration variant of .d.ts
      // (emitted by tsc for ESM/CJS package outputs, or hand-written for ambient JS
      // interop). Excluded for the same reason .d.ts is: they carry no executable
      // code, so scanning them emits noise findings on legitimate `declare`/`any`
      // JS-interop constructs and inflates linesScanned, diluting the SlopScore
      // (able to pull a moderate repo below the --fail-on moderate/heavy ceiling into
      // a false-clean PASS). fix-walk-scans-d-mts-d-cts-declaration-files: the v0.9.0
      // .mjs/.cjs/.mts/.cts glob addition missed these in the ignore list.
      "**/*.d.mts",
      "**/*.d.cts",
      // feat-ignore-user-globs: user-supplied globs from the repeatable
      // `--ignore <glob>` CLI flag (and the SLOPAUDIT_IGNORE Action env),
      // appended to the built-in list so repo-specific generated/vendored/
      // example dirs the hardcoded list misses are excluded too.
      ...extraIgnores,
    ],
  });

  // fast-glob ordering is not guaranteed stable across platforms; sort to lock it.
  return entries.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
