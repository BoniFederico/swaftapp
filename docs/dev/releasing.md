# Releasing Swaft

Maintainer notes. Not published on the docs site or the wiki.

## How a release is built

[`.github/workflows/release.yml`](../../.github/workflows/release.yml) runs on every pushed `v*` tag.
It has three jobs:

1. **gate** (Linux) checks that the tag matches `apps/desktop/package.json`'s version. It then runs
   `npm run verify`, builds the app, and runs the e2e smoke test under `xvfb`. If anything fails,
   nothing is built.
2. **build** (matrix: `ubuntu-latest`, `windows-latest`, `macos-latest`) runs
   `npm --workspace @swaft/desktop run package -- --publish never`. Each runner produces its own
   installers, configured in [`apps/desktop/electron-builder.yml`](../../apps/desktop/electron-builder.yml):
   - Windows: NSIS `Swaft-<v>-setup.exe`
   - Linux: `Swaft-<v>-x86_64.AppImage` and `swaft_<v>_amd64.deb`
   - macOS: `Swaft-<v>-arm64.dmg` and `Swaft-<v>-x64.dmg`
3. **publish** collects all installers and writes `SHA256SUMS.txt`. It takes the release notes from
   the matching `## [<v>]` section of [`CHANGELOG.md`](../../CHANGELOG.md), then creates the GitHub
   Release `v<v>`.

The workflow can also be started by hand from the *Actions* tab (**Run workflow**). A manual run
creates a **draft** release by default, which is useful as a dry run. Delete the draft afterwards.

Actions minutes are free for public repositories, so the macOS job costs nothing.

## Checklist

1. Make sure `main` is green.
2. Bump the version in all three manifests to the same value, then refresh the lockfile:

   ```bash
   npm version 1.2.3 --no-git-tag-version --workspaces --include-workspace-root
   npm install --package-lock-only
   ```

3. In `CHANGELOG.md`, rename `## [Unreleased]` to `## [1.2.3] - YYYY-MM-DD` and add a new empty
   `## [Unreleased]` above it. Update the compare links at the bottom.
4. Commit the change (`chore(release): v1.2.3`) through a PR and merge it.
5. Tag the merge commit and push the tag:

   ```bash
   git checkout main && git pull
   git tag -a v1.2.3 -m "Swaft v1.2.3"
   git push origin v1.2.3
   ```

6. Watch the **Release** workflow. When it finishes, open the release and check that the five
   installers and `SHA256SUMS.txt` are attached. Smoke-test at least one installer.

## Code signing (not set up yet)

The installers are unsigned, so users see SmartScreen and Gatekeeper prompts (documented in
[`docs/installation.md`](../installation.md)). To sign them:

- **Windows:** add a code-signing certificate as the `CSC_LINK` / `CSC_KEY_PASSWORD` secrets, or use
  Azure Trusted Signing.
- **macOS:** add a Developer ID certificate (`CSC_LINK` / `CSC_KEY_PASSWORD`) plus `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` for notarization. Then remove
  `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` from the build job and set `notarize: true` under `mac:` in
  `electron-builder.yml`.

## Docs and wiki

- Every push to `main` that touches `docs/` redeploys GitHub Pages (`pages.yml`).
- The same push regenerates the wiki (`wiki.yml`, via `scripts/docs-to-wiki.mjs`). Never edit the
  wiki by hand: the next sync overwrites it.
- To refresh the screenshots, run `npm run screenshots`. It drives the built app through
  `examples/demo-workspace`, and the API and scenario shots need network access to httpbin.org.
