# Build setup — manual next steps

The repo is fully scaffolded and builds/tests locally. These are the one-time,
human-only steps to publish it and wire up CI. None of these are automated by the
build.

## 1. Run it locally

```bash
npm install        # install deps
npm run build      # tsc -> dist/
npm test           # vitest run
node dist/cli.js . # run the built CLI against this repo (or any JS/TS repo path)
```

`npm run build` produces `dist/cli.js`, which is the published `slopaudit` bin entry.

## 2. Create the GitHub repository

The package metadata points at `https://github.com/SuperMarioYL/slopaudit`. Create
that repo (or update `repository` / `homepage` / `bugs` in `package.json` if you use
a different name/owner), then push:

```bash
git init                  # if not already a git repo
git add -A
git commit -m "SlopAudit v0.1.0"
git branch -M main
git remote add origin https://github.com/SuperMarioYL/slopaudit.git
git push -u origin main
```

CI (`.github/workflows/ci.yml`) runs on every push and PR: Node 22, `npm ci`,
`npm run build`, `npm test`. No secrets are required for CI to pass.

## 3. Publish to npm

`npx slopaudit .` only works once the package is on the npm registry.

1. Make sure the package name `slopaudit` is available (or rename in `package.json`).
2. Log in once on your machine:
   ```bash
   npm login
   ```
3. Publish:
   ```bash
   npm publish --access public
   ```
   `prepublishOnly` runs `tsc` first, and the `files` field ships only `dist/`.

After this, `npx slopaudit .` and the npm version badge in the README resolve.

## 4. (Optional) Automated publish from CI

If you later want a release workflow to publish on tag push instead of publishing
by hand:

1. Create an npm **automation** access token: npmjs.com → Account → Access Tokens →
   Generate New Token → *Automation*.
2. Add it to the GitHub repo as a secret named `NPM_TOKEN`
   (Settings → Secrets and variables → Actions → New repository secret).
3. Add a publish job that sets `registry-url` and uses
   `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` with `npm publish --access public`,
   gated on a `v*` tag. (Not included by default — the current CI only builds and
   tests.)

## 5. (Optional) Self-audit badge

Run `node dist/cli.js .` and commit the generated `slopaudit-badge.svg` so the
README's `![SlopScore](./slopaudit-badge.svg)` resolves and the repo wears its own
score.
