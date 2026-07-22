---
title: Workspaces
layout: default
parent: User guide
nav_order: 1
---

# Workspaces
{: .no_toc }

<details open markdown="block">
  <summary>Table of contents</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

---

A **workspace** is everything you own in Swaft: projects, folders, tags, templates, releases,
environments and settings. You create it from the homepage and it opens into the workspace shell.

## Storage modes

You choose a storage mode when you create the workspace. **It cannot be changed later** — moving
between modes means creating a new workspace and re-importing.

### Local (`.swaft` file)

A single portable file backed by SQLite. Copy it, back it up, or e-mail it like any document.
Ideal for a personal, self-contained workspace.

- Created with **Create local workspace** → pick a path (default `workspace.swaft`).
- Can be **encrypted** (see below).

### Git (folder of files)

The workspace is stored as a folder of plain, human-readable files instead of one binary blob, so
it can be tracked with **Git**: commit history, branches, diffs and any Git remote (GitHub, GitLab,
a bare repo…) all work.

- Created with **Create Git workspace** → pick a folder, or **Clone** an existing repository.
- Great for teams and for reviewing changes as diffs.
- Git workspaces are **never encrypted at rest by Swaft** — rely on your repository's access
  controls instead.

{: .note }
> Secrets (API tokens, passwords) are **never** written into either storage mode. They live in your
> operating system's secure storage — see [Security & settings](security-and-settings.md#secrets).

## Encryption (local workspaces)

When creating a local workspace you can enable **whole-file encryption**. Swaft derives a key from
your password with **Argon2id** and encrypts the file with **AES-256-GCM**.

- You are prompted for the password every time the workspace is opened.
- Encryption is independent of anything else — there is no separate app login.

{: .warning }
> **There is no recovery.** If you forget an encrypted workspace's password, the data is gone. Keep
> the password somewhere safe.

## The workspace shell

Once open, the workspace shows:

- **Working Tree** (left) — your projects, folders, tags and templates. Always visible.
  See [The Working Tree](working-tree.md).
- **View area** (right) — a tabbed area that shows the editor/view for whatever you open. The view
  is chosen automatically from the template's type.
- **Top bar** — the workspace name, the [environment picker](environments.md), a **Settings** button,
  a **Batcher** toggle, and — for Git workspaces — the **Git status** button.

## Using Git version control

In a Git workspace, the **Git status button** in the top bar opens the Git panel. From there you
can:

| Action | What it does |
|--------|--------------|
| **Status** | See changed / staged files. |
| **Commit** | Commit all changes with a message. |
| **Push / Pull / Fetch** | Sync with the remote (first push adds `-u` automatically). |
| **Branch / Checkout** | Create and switch branches. |
| **Diff** | View a file's changes in a diff viewer. |
| **Discard** | Revert local changes to a file. |
| **Publish / Clone** | Attach a remote, or clone a repo into a new workspace. |

Swaft shells out to the **`git` binary installed on your machine**, so it reuses your existing SSH
keys and credential helpers — there is nothing extra to configure. Make sure `git` is on your
`PATH`.

{: .tip }
> Because a Git workspace is just files, you can also edit history, resolve conflicts, or set up CI
> using your normal Git tooling outside Swaft. Reopen the workspace (or use **Reload**) to pick up
> external changes.

## Opening an existing workspace

From the homepage you can:

- **Open** a `.swaft` file (you'll be prompted for the password if it is encrypted),
- **Open** a Git workspace folder,
- **Clone** a Git repository into a new workspace,
- pick one from the **recent workspaces** list (searchable).

If a workspace was created by a **newer** version of Swaft, it will refuse to open rather than risk
corrupting it — update the app.
