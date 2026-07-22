---
title: Core concepts
layout: default
nav_order: 3
---

# Core concepts
{: .no_toc }

The vocabulary you need to understand the rest of the docs. Each concept links to the guide page
that covers it in depth.
{: .fs-6 .fw-300 }

<details open markdown="block">
  <summary>Table of contents</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

---

## Workspace

A **workspace** is the top-level container and the unit of storage. It holds your projects,
folders, tags, templates, releases, environments and settings. A workspace is one of two storage
modes, chosen at creation and **fixed thereafter**:

- **Local** — a single portable `.swaft` file (a SQLite database), optionally encrypted.
- **Git** — a folder of plain, human-readable files tracked by Git, so the whole workspace can be
  committed, branched, diffed and shared through any Git remote.

There is no server and no user account. Secrets are the one thing that never lives inside the
workspace — they are kept in your operating system's secure storage.

→ [Workspaces](guide/workspaces.md)

## The Working Tree

The **Working Tree** is the always-visible left pane. It organizes everything in the workspace:

| Entity | Role |
|--------|------|
| **Project** | A top-level container that **filters** the tree. Everything lives under a project. |
| **Folder** | Groups templates. Folders can nest, and for API templates a folder also acts as an **HTTP collection** that propagates shared headers, proxy, auth and pre/post actions to the requests inside it. |
| **Tag** | A cross-cutting label you can apply to templates and filter by. |
| **Template** | The core authored unit (see below). |

→ [The Working Tree](guide/working-tree.md)

## Templates

A **template** is the fundamental building block. Every template has a **type** that determines
which editor and view it opens in:

| Type | What it is | Opens in |
|------|-----------|----------|
| **`document`** | A Seebo text template rendered from typed inputs (report, e-mail, payload, diagram…). | [Document view](guide/document-templates.md) |
| **`api`** | A structured HTTP request. | [API view](guide/api-requests.md) |
| **`capability`** | Sandboxed JavaScript that returns **data** for use inside formulas. | [Code view](guide/code-and-actions.md) |
| **`action`** | Sandboxed JavaScript that performs a confirmed **side effect**. | [Code view](guide/code-and-actions.md) |
| **`scenario`** | A visual graph that chains the above into a runnable workflow. | [Scenario canvas](guide/scenarios.md) |

Each type also has a **subtype**. For documents the subtype selects how output is rendered
(`markdown`, `html`, `mermaid`, `echarts`, `swagger`, `eml`, or a highlighted code language such as
`json`, `yaml`, `sql`…). See the [template types reference](guide/document-templates.md#subtypes).

## Seebo & formulas

Swaft is built on the **Seebo** template engine. Anywhere you see `${ … }` you are writing a
**Seebo formula**: a small, typed, side-effect-free expression language. Formulas:

- declare **inputs** through *widget capabilities* — `${ textbox({ id:'name', type:string() }) }`
  renders a text box in the Input panel;
- read **data** through *data capabilities* — `${ env('BASE_URL') }`, `${ template('config') }`,
  `${ previous('login').json.token }`;
- compute values with types, operators, `match`, and methods — `${ name.upper() }`,
  `${ price * qty }`;
- can declare **actions** — `${ action({ id:'save', type:'myAction', confirm:true }) }`.

→ [Seebo formula reference](seebo/index.md)

## Environments

An **environment** is a named set of variables (plain string values) such as `BASE_URL` or
`REGION`. You pick one **active environment** from the top bar; formulas read it with `env('KEY')`
(or the shorthand `${ KEY }`). Environments can be **personal** to you or **shared** across the
workspace.

→ [Environments](guide/environments.md)

## Releases

A **release** is a named, versioned snapshot of a template plus a **changelog**. Releases let you
freeze a known-good version while you keep editing the draft. **Release selection** — which version
you actually use — is a personal, local choice, so different people can pin different versions of
the same shared template.

→ [Releases](guide/batcher-and-releases.md#releases)

## Actions & receipts

An **action** is a declared side effect (write a variable, call out, record something). Actions are
special because they are the only things in Swaft that *change the outside world*, so they are
governed:

- an action **never runs without explicit confirmation**;
- the backend re-derives the authoritative action plan itself — it never trusts the UI;
- every execution produces a **receipt** (a redacted, local-only record of what happened).

→ [Code & actions](guide/code-and-actions.md)

## Scenarios

A **scenario** is a visual workflow: a canvas of **blocks** (API requests, actions, capabilities)
plus **control nodes** (start, decision, delay), connected by edges. Running a scenario executes
the blocks in order; each block can read earlier blocks' outputs with `previous('alias')`, and the
whole run records a unified history.

→ [Scenarios](guide/scenarios.md)

## Security model in one paragraph

Swaft's backend (the Electron **main process**) is the security authority — the UI can only ask it
to do things through a validated, allow-listed channel. Code templates run in an **isolated,
sandboxed process** with no ambient file or network access. Secrets are stored in the **OS
keychain** and never handed back to the UI in clear. Outbound HTTP is filtered by a **blocked-domain
list** with redirect re-validation. A workspace file can be **encrypted** with Argon2id +
AES-256-GCM. Code that arrives *inside* a shared workspace is **untrusted until you approve it**.

→ [Security & settings](guide/security-and-settings.md)
