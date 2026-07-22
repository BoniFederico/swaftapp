---
title: Security & settings
layout: default
parent: User guide
nav_order: 9
---

# Security & settings
{: .no_toc }

<details open markdown="block">
  <summary>Table of contents</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

---

Swaft is built so that the parts that touch the outside world — the network, the file system,
secrets, code execution — are governed by the **backend**, not the UI. This page covers the
security model and the **Settings** that tune it.

## The trust boundary

Swaft is an Electron app with two processes:

- the **renderer** (the UI you see), and
- the **main process** (the backend authority).

The renderer can only ask the backend to do things through a **validated, allow-listed channel** —
there is no local web server and no direct system access from the UI. Every rule below is enforced
in the backend, so the UI cannot bypass it.

## Secrets

API tokens, passwords and keys are **secrets**. Swaft stores them in your operating system's secure
storage (Windows DPAPI / macOS Keychain, via Electron `safeStorage`). The workspace only ever holds
an **opaque reference** to a secret — the value itself is:

- **never** written into the `.swaft` file or a Git workspace,
- **never** returned to the UI in clear,
- **never** shown in action [receipts](code-and-actions.md#confirmation-execution--receipts) or API
  history.

Enter credentials as secrets in the [API Auth tab](api-requests.md#authentication), not as environment
variables or plain text.

## Workspace encryption

A **local** workspace can be encrypted as a whole file. Swaft derives a key from your password with
**Argon2id** and encrypts with **AES-256-GCM**. You are prompted for the password each time you open
it.

{: .warning }
> Encryption is **unrecoverable by design** — there is no backdoor or reset. Lose the password and
> the data is gone. (Git workspaces are not encrypted by Swaft; use your repository's access
> controls.)

## Code sandbox & execution mode

[Capability and action code](code-and-actions.md) runs in an **isolated sandbox** with no ambient file
or network access, JSON-only results, and a per-call timeout. Only the **sandbox** profile exists in
the current build.

The workspace has an **execution mode**:

| Mode | Effect |
|------|--------|
| **sandbox** (default) | Actions targeting the `prod` environment are **forbidden**. |
| **dev** | Unlocks `prod`-targeted actions. Switching to `dev` is a **guarded** action (it must be explicitly confirmed). |

Code that **arrived inside a workspace you opened** (authored elsewhere) is **untrusted** until you
approve it on this device — see [Trusting imported code](code-and-actions.md#trusting-imported-code).

## Restrictions

**Settings → Restrictions** governs outgoing HTTP for the whole workspace, through the backend HTTP
client:

| Setting | Effect |
|---------|--------|
| **Blocked domains** | A block-list of hosts that outgoing requests may **not** target (anchored host match). Empty = allow all. Re-checked on every redirect. |
| **Proxy URL** | Route **every** outgoing request through this proxy (empty = direct). |
| **Enforced headers** | Headers **force-applied** to every outgoing request, overriding the request's own. |
| **Batcher** | Show or hide the [Batcher](batcher-and-releases.md#the-batcher). |

These are the workspace-wide controls; individual [folders](working-tree.md#folders) can additionally
propagate their own headers, proxy and auth to the requests they contain.

## Other settings

**Settings → General** covers workspace-level options and the execution mode. **Settings →
Environments** manages [environment variables](environments.md).

## Preferences

**Settings → Preferences** holds your **personal, local-only** choices — they are never synchronized
or shared:

- **Theme** — light / dark (and follow-system).
- **Primary colour** — pick an accent from a small curated set.
- **Language** — the UI is localized; English and Italian ship in the box.

## What Swaft does *not* do (yet)

For an accurate mental model, note the current build:

- has **no user account / sign-in** — it is local-first;
- has **no peer-to-peer or server sync** (share via a file or Git instead);
- has **no built-in database client**;
- implements only the **sandbox** code profile (no file/network access for user code).
