# Contributing to Swaft

Thanks for your interest in improving Swaft! Bug reports, documentation fixes and pull requests are
all welcome.

## Ways to contribute

- **Report a bug** — open an [issue](https://github.com/BoniFederico/swaftapp/issues/new/choose)
  using the *Bug report* template. Include your OS, the Swaft version (or commit) and the steps to
  reproduce.
- **Suggest a feature** — use the *Feature request* template and describe the problem you want to
  solve, not only the solution.
- **Improve the docs** — everything under [`docs/`](docs/) is the source of both the
  [documentation site](https://bonifederico.github.io/swaftapp/) and the GitHub Wiki (the wiki is
  generated automatically: edit `docs/`, never the wiki directly).
- **Send a pull request** — see below.

Please report security issues privately, as described in [SECURITY.md](SECURITY.md).

## Development setup

Full instructions are in [Building from source](docs/building-from-source.md). In short:

```bash
git clone https://github.com/BoniFederico/swaftapp.git
cd swaftapp
npm ci
npm run dev
```

Requirements: Node.js 20 or newer (see `.nvmrc`), npm 10 or newer, and Git if you want to use
Git-backed workspaces.

## Pull request checklist

1. Branch from `main` (`feature/<topic>` or `fix/<topic>`).
2. Keep the change focused — one topic per PR.
3. Add or update tests for behaviour changes (Vitest, next to the code: `*.test.ts(x)`).
4. Run the standard gate and make sure it passes:

   ```bash
   npm run verify     # typecheck + lint + unit/component tests
   ```

   For UI flows, also run the end-to-end smoke test: `npm run build && npm run e2e`.
5. Update the docs in `docs/` when you change something user-visible, and add a line to the
   `Unreleased` section of [CHANGELOG.md](CHANGELOG.md).
6. Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages, e.g.
   `fix(scenarios): …`, `feat(api): …`, `docs: …`.

## Code style

- TypeScript everywhere; Prettier formats (`npm run format`) and ESLint lints (`npm run lint`).
- The main process is the authority: the renderer talks to it only through the typed op contract in
  [`packages/shared`](packages/shared) and the single allow-listed IPC channel. New capabilities
  belong in a main-process service plus an op, never in the preload.
- User-facing strings go through the i18n catalog
  (`apps/desktop/src/renderer/src/i18n/catalogs.ts`), in both English and Italian.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating you agree to
uphold it.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
