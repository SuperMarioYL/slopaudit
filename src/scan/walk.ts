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
 */
export async function walk(root: string): Promise<string[]> {
  const cwd = path.resolve(root);

  const entries = await fg("**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}", {
    cwd,
    absolute: true,
    onlyFiles: true,
    dot: false,
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
      "**/*.d.ts",
    ],
  });

  // fast-glob ordering is not guaranteed stable across platforms; sort to lock it.
  return entries.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
