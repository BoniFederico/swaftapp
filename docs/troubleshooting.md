---
title: Troubleshooting
layout: default
nav_order: 8
---

# Troubleshooting
{: .no_toc }

Fixes for the problems people run into most often. If yours isn't listed, search the
[issues](https://github.com/BoniFederico/swaftapp/issues) or open a new one.
{: .fs-6 .fw-300 }

<details open markdown="block">
  <summary>Table of contents</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

---

## Installing and launching

### Windows: "Windows protected your PC"

SmartScreen warns about installers that aren't code-signed. Click **More info → Run anyway**. See
[Installation › Windows](installation.md#windows).

### macOS: "Swaft cannot be opened" or "Swaft is damaged"

Gatekeeper blocks apps that aren't notarized. Allow it under **System Settings → Privacy &
Security → Open Anyway**, or run `xattr -dr com.apple.quarantine /Applications/Swaft.app`. See
[Installation › macOS](installation.md#macos).

### Linux: the AppImage doesn't start

- *"AppImages require FUSE to run"*: install `libfuse2t64` (Ubuntu 24.04) or `libfuse2`, or start
  it with `--appimage-extract-and-run`.
- *"The SUID sandbox helper binary was found, but is not configured correctly"* or an immediate
  crash on Ubuntu 24.04 or later: the system restricts the user namespaces that Chromium's sandbox
  uses. Install the `.deb` package instead, which sets the sandbox up properly. As a last resort,
  start the AppImage with `--no-sandbox`.

### Running from source: `Error: Electron uninstall`

The Electron binary didn't download or unpack during `npm ci` (often because of a proxy or an
interrupted install). Reinstall it:

```bash
rm -rf node_modules && npm ci
```

Behind a corporate proxy, set `HTTPS_PROXY` before installing, or point `ELECTRON_MIRROR` at an
internal mirror.

### Running from source: the window never opens, and the terminal shows Node output

`ELECTRON_RUN_AS_NODE` is set in your environment (some editors set it for their integrated
terminals), so Electron runs as plain Node. Unset it and try again:

```bash
unset ELECTRON_RUN_AS_NODE                         # bash / zsh
Remove-Item Env:ELECTRON_RUN_AS_NODE               # PowerShell
```

## Secrets

### Linux: "secrets are only obfuscated"

**Settings → Secrets** shows this warning when no OS keyring is available. Electron then falls back
to a fixed key, so stored secrets aren't really protected. Install and unlock a keyring, then
restart Swaft:

- GNOME, Cinnamon, Xfce and similar: `gnome-keyring` (plus `libsecret-1-0`)
- KDE Plasma: KWallet
- Window managers without a session keyring: start `gnome-keyring-daemon` from your session
  startup, or pass `--password-store=gnome-libsecret` (or `kwallet5` / `kwallet6`)

Secrets saved before the keyring was available were encrypted with the fallback key. Set them again
afterwards.

### "Secret … can no longer be decrypted on this machine"

Secrets are encrypted with your OS account's key. This error appears after copying a profile to
another computer or user, or after resetting the keyring. Set the value again in
**Settings → Secrets**. Workspace files are not affected: secrets are never stored in them.

### My secrets disappeared

If `secrets.json` in the [profile folder](installation.md#where-swaft-keeps-your-data) was
corrupted, Swaft starts with an empty list and moves the damaged file aside as
`secrets.json.corrupt-<timestamp>`, so nothing is overwritten.

## Git workspaces

### "Git does not know who you are yet"

Git needs an author identity before it can commit. Set one globally:

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

### "The remote asked for credentials"

Swaft can't answer interactive prompts, so it fails fast instead of hanging. Use one of these:

- **HTTPS:** a credential helper, such as [Git Credential Manager](https://github.com/git-ecosystem/git-credential-manager)
  (bundled with Git for Windows) or `git config --global credential.helper osxkeychain` on macOS.
  Sign in once from a terminal (`git fetch` in the repository) and Swaft reuses the stored
  credentials.
- **SSH:** a key loaded in your SSH agent (`ssh-add`), with the host already in `known_hosts`. Run
  `ssh -T git@github.com` once from a terminal to accept the host key.

### "did not finish within 10 minutes and was stopped"

A Git command was stopped after 10 minutes, usually because of an unreachable remote or a network
problem. Check that `git fetch` works from a terminal in the same folder.

## Workspaces and requests

### A template shows "Waiting for input"

The template declares inputs (`textbox`, `listbox`, …) that have no value yet. Fill them in the
**Input** panel. To keep the values, click **Save input config** or press Ctrl/Cmd+S.

### `env('…')` resolves to nothing, or requests go to the wrong host

No environment is selected, or the selected one doesn't define the variable. Pick one from the
**environment picker** in the header (the demo workspace uses **Public echo**). See
[Environments](guide/environments.md).

### A request fails with `DOMAIN_NOT_ALLOWED`

The workspace's restrictions block that host. Check **Settings → Restrictions → Blocked HTTP domains**.
See [Security & settings](guide/security-and-settings.md).

## Reporting a bug

Open a [bug report](https://github.com/BoniFederico/swaftapp/issues/new/choose) and include:

- your OS
- the Swaft version
- the workspace type
- the steps to reproduce

Remove secrets and personal data from logs and screenshots. Report security issues privately (see
[SECURITY.md](https://github.com/BoniFederico/swaftapp/blob/main/SECURITY.md)).
