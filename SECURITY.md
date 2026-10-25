# Security policy

## Supported versions

Security fixes are released for the latest minor version of Swaft.

| Version | Supported |
|---------|-----------|
| 1.0.x   | ✅        |
| < 1.0   | ❌        |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report them privately through
[GitHub private vulnerability reporting](https://github.com/BoniFederico/swaftapp/security/advisories/new)
or by email to **federicoboni67@gmail.com**. Include:

- the affected version (or commit) and operating system,
- a description of the issue and its impact,
- steps or a proof of concept to reproduce it.

You can expect an acknowledgement within a few days. Once the issue is confirmed, a fix is prepared
and released, and you are credited in the release notes unless you prefer to stay anonymous.

## Security model in brief

Swaft is a local-first desktop app. The parts most relevant to security reports are:

- **Process isolation** — the renderer runs with `contextIsolation`, `sandbox` and no Node
  integration; it reaches the main process only through one allow-listed IPC channel whose ops are
  schema-validated and sender-checked.
- **User code** (capabilities, actions) runs in a separate utility process with a time budget, and
  its network access goes through the same policy as API requests (blocked domains, execution mode).
- **Secrets** are stored with the operating system's protection (DPAPI on Windows, Keychain on
  macOS, the Secret Service / KWallet on Linux) in the user-data directory — never in workspace
  files, `.swaft` containers or Git.
- **Encrypted `.swaft` files** use Argon2id key derivation and authenticated encryption.

See [Security & settings](docs/guide/security-and-settings.md) for the user-facing details.
