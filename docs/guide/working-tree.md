---
title: The Working Tree
layout: default
parent: User guide
nav_order: 2
---

# The Working Tree
{: .no_toc }

<details open markdown="block">
  <summary>Table of contents</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

---

The **Working Tree** is the always-visible left pane. It is how you organize and navigate
everything in a workspace.

## Projects

A **project** is a top-level container. Everything — folders and templates — lives inside a
project, and selecting a project **filters the tree** to just its contents. Use projects to
separate unrelated bodies of work (e.g. one project per system, customer or integration).

Create one with the **new project** control at the top of the tree. A project has a name, an
optional colour and a description.

## Folders

A **folder** groups templates inside a project. Folders can **nest**, so you can build a hierarchy.

For **API templates**, a folder is more than grouping — it acts as an **HTTP collection**. A folder
can carry shared request policy that is **propagated down** to the requests inside it (and to
nested folders):

- shared **headers**,
- a **proxy**,
- default **authentication**,
- **pre/post actions**,
- free-form **notes** (Markdown).

An API request inside the folder can **inherit** any of these, so you configure common settings
once. See [API requests → Inheriting from folders](api-requests.md#inheriting-from-folders).

Open a folder to see its detail view, where you edit that propagated policy and its notes.

## Tags

A **tag** is a cross-cutting label. Unlike folders (where a template lives in exactly one place),
you can apply **many tags** to a template and filter the tree by tag. Use tags for themes that cut
across folders — `draft`, `smoke-test`, `customer-x`, and so on.

## Templates

A **template** is the authored unit. In the tree each template shows an **icon for its type** and,
for API templates, a **method badge** (GET/POST/…). Create a template from a folder's or project's
context menu; you pick its [type](../concepts.md#templates) on creation.

The tree can be grouped/filtered by **type** and by **tag**, so you can quickly narrow a large
workspace.

## Context menu actions

Right-click (or use the three-dot menu on) a template for its actions:

| Action | Effect |
|--------|--------|
| **Open** | Open the template in its type-appropriate view. |
| **Edit source** | Open the raw source editor (`TemplateEditorModal`). |
| **Rename** | Rename the template. |
| **Clone** | Duplicate it as a new draft. |
| **Delete** | Remove it (with confirmation). |
| **Select release** | Choose which [release](batcher-and-releases.md#releases) you use — a personal, local choice. |

Folders have their own menu for creating templates/subfolders, renaming and deleting.

{: .tip }
> Templates can be **dragged** from the tree onto the [Batcher](batcher-and-releases.md#the-batcher)
> or a [Scenario](scenarios.md) canvas — that's how you compose and wire them together.
