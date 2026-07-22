---
title: Getting started
layout: default
nav_order: 2
---

# Getting started
{: .no_toc }

This page takes you from an empty machine to a first rendered template.
{: .fs-6 .fw-300 }

<details open markdown="block">
  <summary>Table of contents</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

---

## Requirements

- **Node.js 20 LTS or newer** (developed on Node 20–24) and **npm ≥ 10** — needed to run or build
  the app from source.
- **Windows or macOS** (the current build targets). Linux builds are produced by CI but less
  exercised.
- **[Git](https://git-scm.com/)** on your `PATH` — optional, only required if you want to use a
  **Git-backed workspace**. Swaft calls your installed `git` binary directly and reuses your
  existing SSH keys / credential helper.

{: .note }
> There is **no account and no sign-in**. Swaft is local-first: you launch the app and go
> straight to the homepage. The only password you may ever set is the optional one that
> **encrypts a workspace file** (see [Workspaces](guide/workspaces.md)).

## Install and run

Swaft is currently run from source. Clone the repository and install dependencies:

```bash
git clone https://github.com/BoniFederico/swaft.git
cd swaft
npm install
```

The first install downloads the Electron binary, so it needs network access. If a later
`npm run dev` fails with `Error: Electron uninstall`, the binary did not unpack — reinstall
cleanly:

```bash
rm -rf node_modules package-lock.json && npm install
```

Launch the app with hot-reload:

```bash
npm run dev      # or: npm run see  (an alias)
```

To produce an installable desktop package instead, see
[Building from source](building-from-source.md).

## Your first workspace

When the app opens you land on the **homepage**. Create a workspace:

1. Click **Create local workspace**.
2. Choose a file location and name (e.g. `demo.swaft`).
3. *(Optional)* Turn on **encryption** and set a password.
   {: .warning }
   > If you encrypt a workspace and lose the password, the data is **unrecoverable** — there is no
   > backdoor and no reset.
4. The workspace opens into the **Workspace shell**: the **Working Tree** on the left, a tabbed
   view area on the right, and a top bar with the environment picker, settings and (for Git
   workspaces) the Git status button.

Prefer files you can track in Git? Choose **Create Git workspace** and point it at a folder — Swaft
stores the workspace as plain, diff-friendly files instead of a single binary `.swaft`. See
[Workspaces](guide/workspaces.md) for the trade-offs.

## Your first template

1. In the Working Tree, create a **Project** (a top-level container that filters the tree), then
   inside it create a **Document** template.
2. A new document opens already renderable, with one input widget. Its source is:

   ```text
   Hello ${ textbox({ id: 'name', label: 'Your name', type: string() }) }!
   ```

   That `${ … }` is a **Seebo formula**. `textbox({ … })` declares an input; the **Input panel**
   on the left renders a text box for it.
3. Type a value into the **Your name** field. The **Output** updates to `Hello <name>!`.

That is the core loop: **a template declares inputs with formulas, you fill the Input panel, Swaft
renders the output.** From here you can:

- Switch the document **subtype** (Markdown, HTML, Mermaid, ECharts, JSON, YAML, e-mail…) to change
  how the output is rendered — see [Document templates](guide/document-templates.md).
- Build an **[API request](guide/api-requests.md)** whose URL, headers and body contain the same
  `${ … }` formulas.
- Add **[environments](guide/environments.md)** so `${ BASE_URL }` resolves from a variable set you
  can switch in one click.
- Cut a **[release](guide/batcher-and-releases.md)** to freeze a version of the template.

## Verify a source checkout

If you cloned the repo to develop, confirm everything is wired up:

```bash
npm run verify   # typecheck + lint + unit/component tests
```

See [Building from source](building-from-source.md) for the full script list, the heavy test suites
and the end-to-end smoke test.

## Where to go next

- **[Core concepts](concepts.md)** — the vocabulary (workspace, Working Tree, template types,
  releases, environments) in one page.
- **[User guide](guide/index.md)** — step-by-step for every feature.
- **[Seebo formulas](seebo/index.md)** — everything you can write inside `${ … }`.
