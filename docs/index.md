---
title: Home
layout: default
nav_order: 1
description: "Swaft — a desktop-first technical workspace built on the Seebo template engine."
permalink: /
---

# Swaft
{: .fs-9 }

A desktop-first workspace for technicians, developers and power users: author versioned
**templates**, fire structured **HTTP requests**, run sandboxed **code** and **actions**, and
wire it all together in visual **scenarios** — locally, or backed by a Git repository.
{: .fs-6 .fw-300 }

[Get started](getting-started.md){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 .mr-2 }
[View on GitHub](https://github.com/BoniFederico/swaftapp){: .btn .fs-5 .mb-4 .mb-md-0 }

---

## What is Swaft?

**Swaft** ("Strange Workspace App for Technician") is an [Electron](https://www.electronjs.org/)
desktop application. It gives Application-Management teams, integrators and technical authors a
single place to create, organize, render, execute and version the small technical artifacts they
use every day:

- **Documents** — reports, e-mails, YAML/JSON payloads, diagrams and more, generated from typed
  inputs using the [Seebo](seebo/index.md) template language.
- **API requests** — a real, structured HTTP client (not cURL strings) with auth, history and
  per-request automation.
- **Code** — sandboxed JavaScript **capabilities** (pure data for your formulas) and **actions**
  (confirmed side effects, with receipts).
- **Scenarios** — a visual canvas that chains requests, actions and capabilities into a runnable
  workflow.

Everything lives inside a **workspace** you own: a single portable `.swaft` file, a plain folder of
readable files, or a folder tracked by **Git**.

## Why Swaft?

| Principle | What it means for you |
|-----------|-----------------------|
| **Local-first** | A workspace is a file, a folder or a Git repo. No server, no account, no sign-up — open the app and start. |
| **Structured, not stringly-typed** | API requests are a real request model; documents are typed templates; releases are immutable snapshots. |
| **Safe by default** | Code runs in an isolated sandbox, actions never run without confirmation, secrets live in the OS keychain, and outbound HTTP is governed by a block-list. |
| **Versioned** | Any template can be cut into named **releases** with a changelog; you pick which release you use. |
| **Yours to move** | Package a workspace as a single `.swaft` file, or keep it as plain, documented files in a folder or Git repository. |

## Explore the docs

<div class="code-example" markdown="1">

- **[Installation](installation.md)** — download and install Swaft on Windows, macOS or Linux.
- **[Getting started](getting-started.md)** — create a workspace and build your first template.
- **[Core concepts](concepts.md)** — workspaces, the Working Tree, templates, releases, environments.
- **[User guide](guide/index.md)** — a task-by-task walkthrough of every part of the app.
- **[Seebo formulas](seebo/index.md)** — the `${ … }` template language reference.
- **[Reference](reference/index.md)** — the on-disk workspace format.
- **[Troubleshooting](troubleshooting.md)** — fixes for common problems.
- **[Building from source](building-from-source.md)** — for contributors.

</div>

{: .note }
> These docs describe **Swaft v1.0.0**, the first stable release, as it currently behaves — not a
> future roadmap. Swaft is free software released under the MIT license.
