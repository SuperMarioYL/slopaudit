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

/**
 * fix-readme-action-example-version-drift: at the shipped v0.16.0 tag both READMEs'
 * copy-paste Action example still pinned the PREVIOUS release —
 * `uses: SuperMarioYL/slopaudit@v0.15.0` with `version: "0.15.0"` — while VERSION,
 * package.json and web/site.json all said 0.16.0. The drift was introduced by the
 * v0.16.0 docs refresh and nothing caught it: the block above pins only VERSION
 * against package.json. These cases extend the same lockstep contract to the
 * remaining user-facing surfaces that quote the release version, so a docs refresh
 * can no longer ship a stale pin.
 */
const READMES = ["README.md", "README.zh-CN.md"] as const;
const version = versionFile.trim();
const bareVersion = version.replace(/^v/, "");

function readmeText(name: string): string {
  return readFileSync(join(root, name), "utf8");
}

describe("version lockstep across user-facing surfaces (fix-readme-action-example-version-drift)", () => {
  for (const name of READMES) {
    it(`${name} pins the Action ref to the release version`, () => {
      const m = readmeText(name).match(
        /-\s*uses:\s*SuperMarioYL\/slopaudit@v(\d+\.\d+\.\d+)/,
      );
      expect(m, `${name} has no Action example pinning a version`).not.toBeNull();
      expect(m![1]).toBe(bareVersion);
    });

    it(`${name} pins the Action version input to the release version`, () => {
      const m = readmeText(name).match(/\n\s*version:\s*"(\d+\.\d+\.\d+)"/);
      expect(m, `${name} has no Action version input`).not.toBeNull();
      expect(m![1]).toBe(bareVersion);
    });
  }

  it("web/site.json's content version matches the release version", () => {
    const site = JSON.parse(readFileSync(join(root, "web", "site.json"), "utf8")) as {
      content_version?: string;
      meta?: { content_version?: string };
    };
    expect(site.meta?.content_version).toBe(version);
    expect(site.content_version).toBe(version);
  });

  /**
   * fix-package-lock-version-drift: package-lock.json's root version (both the
   * top-level field and packages[""]) was still "0.15.0" at the v0.17.0 tag —
   * two releases after VERSION, package.json and web/site.json moved on — and
   * `npm install --package-lock-only` silently rewrote it, leaving every
   * contributor a spurious lock diff. The VERSION vs package.json case above did
   * not cover this third manifest, so the drift survived two bumps.
   */
  it("package-lock.json's root version matches the release version", () => {
    const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")) as {
      version?: string;
      packages?: Record<string, { version?: string }>;
    };
    expect(lock.version).toBe(bareVersion);
    expect(lock.packages?.[""]?.version).toBe(bareVersion);
  });

  it("CHANGELOG.md documents the release version", () => {
    const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain(`## [${bareVersion}]`);
  });
});
