---
title: Installation
layout: default
nav_order: 2
---

# Installation
{: .no_toc }

Download the installer for your operating system from GitHub Releases. Swaft runs entirely on your
machine, with no account and no sign-in.
{: .fs-6 .fw-300 }

<details open markdown="block">
  <summary>Table of contents</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

---

## Download

Open the **[latest release](https://github.com/BoniFederico/swaftapp/releases/latest)** and download
the file for your system:

| System | File | Notes |
|--------|------|-------|
| **Windows** 10/11 (x64) | `Swaft-<version>-setup.exe` | Installer with Start-menu and desktop shortcuts. |
| **macOS** on Apple silicon (M1 and later) | `Swaft-<version>-arm64.dmg` | |
| **macOS** on Intel | `Swaft-<version>-x64.dmg` | |
| **Linux** (x64), any distribution | `Swaft-<version>-x86_64.AppImage` | Portable single file. |
| **Linux** (x64), Debian / Ubuntu | `swaft_<version>_amd64.deb` | Installs a menu entry. |

Each release also includes a `SHA256SUMS.txt`. To check a download:

```bash
sha256sum --check --ignore-missing SHA256SUMS.txt        # Linux
shasum -a 256 Swaft-*.dmg                                # macOS: compare with SHA256SUMS.txt
Get-FileHash .\Swaft-*-setup.exe -Algorithm SHA256       # Windows PowerShell
```

{: .note }
> The builds are **not code-signed yet**, so Windows and macOS ask for a one-time confirmation the
> first time you open Swaft. The steps for each system are below.

**Optional:** to use Git-backed workspaces, install [Git](https://git-scm.com/downloads) and make
sure `git` is on your `PATH`. Swaft uses your installed Git, so your SSH keys and credential helper
keep working.

## Windows

1. Run `Swaft-<version>-setup.exe`.
2. If **Microsoft Defender SmartScreen** shows *"Windows protected your PC"*, click **More info**,
   then **Run anyway**. This appears because the installer is not signed.
3. Accept the MIT license, choose whether to install for yourself only (the default, no
   administrator rights needed) or for all users, and pick the install folder.
4. Start Swaft from the Start menu or the desktop shortcut.

**Update:** run the newer installer; it replaces the old version and keeps your data.
**Uninstall:** *Settings → Apps → Installed apps → Swaft → Uninstall*.

## macOS

1. Open the `.dmg` for your Mac (Apple menu → *About This Mac* shows **Chip: Apple M…** for
   Apple silicon or **Processor: Intel** for Intel).
2. Drag **Swaft** into **Applications**.
3. The first time, macOS reports that Swaft *"cannot be opened because Apple cannot check it for
   malicious software"* (or that it *"is damaged"*). This is because the app is not notarized.
   Either:
   - open **System Settings → Privacy & Security**, scroll to the message about Swaft and click
     **Open Anyway**, or
   - remove the quarantine flag in Terminal:

     ```bash
     xattr -dr com.apple.quarantine /Applications/Swaft.app
     ```

4. Open Swaft from Applications or Launchpad.

**Update:** replace `Swaft.app` in Applications with the new one.
**Uninstall:** drag `Swaft.app` to the Trash.

## Linux

### AppImage (any distribution)

```bash
chmod +x Swaft-*-x86_64.AppImage
./Swaft-*-x86_64.AppImage
```

If it fails with a message about **FUSE**, install `libfuse2` (Ubuntu 22.04+:
`sudo apt install libfuse2t64`, or `libfuse2` on older releases), or run it without FUSE:
`./Swaft-*.AppImage --appimage-extract-and-run`.

### Debian / Ubuntu (`.deb`)

```bash
sudo apt install ./swaft_*_amd64.deb
```

Swaft then appears in your applications menu. Uninstall with `sudo apt remove swaft`.

{: .important }
> **Secrets on Linux** are protected by your desktop keyring (GNOME Keyring, KWallet, …). Without
> a running keyring, Swaft warns you in **Settings → Secrets** that stored secrets are only
> obfuscated. See [Troubleshooting](troubleshooting.md#linux-secrets-are-only-obfuscated).

## Where Swaft keeps your data

Swaft stores two kinds of data in different places:

- **Workspaces** are wherever you create them: a `.swaft` file, a plain folder or a Git repository
  you choose. Back them up, sync them or commit them like any other files.
- **Your app profile** (preferences, the recent-workspaces list, a device id, and secrets encrypted
  by the OS) lives in the per-user application-data folder:

  | System | Folder |
  |--------|--------|
  | Windows | `%APPDATA%\Swaft` |
  | macOS | `~/Library/Application Support/Swaft` |
  | Linux | `~/.config/Swaft` |

Uninstalling Swaft never deletes your workspaces. To remove the profile too, delete that folder.
Secrets can't be decrypted on another computer or user account, so after moving to a new machine,
set them again in **Settings → Secrets**.

## Next steps

- [Getting started](getting-started.md): create your first workspace and template.
- Try the **demo workspace**: download
  [`examples/demo-workspace`](https://github.com/BoniFederico/swaftapp/tree/main/examples) (or clone
  the repository), then choose **Open → From folder** on the homepage.
- Prefer to run from source? See [Building from source](building-from-source.md).
