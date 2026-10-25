# Changelog

All notable changes to Swaft are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-10-25

First stable public release.

### Highlights

- **Workspaces** in three storage forms: a single portable `.swaft` file (optionally
  password-encrypted), a plain local folder, or a Git repository — all using the same open,
  human-readable on-disk format.
- **Working Tree** with projects, nested folders, tags, search, drag & drop and tabs.
- **Document templates** (text, Markdown, HTML, JSON, YAML, …) powered by the Seebo formula engine,
  with live preview, input forms and versioned **releases**.
- **API requests**: a full HTTP client (params, headers, body, auth, folder-propagated headers,
  proxies) with history, Seebo formulas everywhere and import/export from/to Postman, Bruno,
  OpenAPI, cURL, HAR and `.http` files.
- **Code & actions**: sandboxed JavaScript capabilities and side-effecting actions with explicit
  confirmation and receipts.
- **Scenarios**: a visual workflow canvas chaining API, document and code blocks with decisions,
  delays, breakpoints, attended input prompts and unattended batch runs.
- **Environments** and OS-keychain **secrets**, per-workspace restrictions (execution mode, blocked
  domains, enforced headers) and an in-app **Git** panel.
- Installers for Windows (NSIS), Linux (AppImage, `.deb`) and macOS (`.dmg`).

### Fixed (since the last pre-release build)

- Scenario runs no longer write into another workspace when the workspace is switched or closed
  mid-run; the run (and its batch) is cancelled instead.
- A failure while recording a run's final state can no longer leave the run stuck as "running".
- Breakpoints no longer pause unattended batch runs.
- Credential-looking inputs (`password`, `token`, `apiKey`, …) are masked in the stored run history.
- The scenario run panel retries transient polling errors instead of freezing.
- A script host killed after a timeout can no longer take down its replacement.
- A corrupt `secrets.json` is set aside instead of being silently overwritten; undecryptable secrets
  report a clear error; Settings → Secrets warns when the OS offers no secure storage (Linux without
  a keyring).
- Git operations never hang on a credential prompt, are time-bounded, and report missing identity
  or credentials with actionable messages.
- Scenario keyboard shortcuts (Ctrl/Cmd+S, undo/redo, Delete) only act on the visible scenario tab,
  never on a hidden one or behind an open dialog.
- The Markdown preview renders `_italic_` and `__bold__`.
- The empty workspace screen no longer shows an outdated development note.

[Unreleased]: https://github.com/BoniFederico/swaftapp/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/BoniFederico/swaftapp/releases/tag/v1.0.0
