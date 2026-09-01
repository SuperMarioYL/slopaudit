import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * fix-version-drift-package-json-lags-version-file: at the shipped v0.14.0 tag
 * package.json's `version` was "0.13.0" while the VERSION file was "v0.14.0", and
 * the CLI's `readVersion()` (src/cli.ts) reads --version from package.json alone —
 * so `slopaudit --version` reported 0.13.0 at a release tagged v0.14.0. The v0.14.0
 * ship bumped the VERSION file but not package.json, reintroducing the exact
 * two-place version-drift the v0.2.0 fix_stale_cli_version milestone eliminated.
 *
 * This test pins the two version surfaces in lockstep so they can never silently
 * drift again: VERSION (with a leading "v" stripped) MUST equal package.json's
 * `version`. At v0.14.0 this fails ("0.14.0" !== "0.13.0"); at v0.15.0 it passes.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  version?: string;
};
const versionFile = readFileSync(join(root, "VERSION"), "utf8").trim();

describe("version lockstep (fix-version-drift-package-json-lags-version-file)", () => {
  it("package.json has a non-empty version", () => {
    expect(typeof pkg.version).toBe("string");
    expect((pkg.version ?? "").length).toBeGreaterThan(0);
  });

  it("the VERSION release marker agrees with package.json's version", () => {
    // VERSION carries a leading "v"; package.json does not. Strip and compare.
    expect(versionFile.replace(/^v/, "")).toBe(pkg.version);
  });
});
