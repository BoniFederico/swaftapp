---
title: Actions & macros
layout: default
parent: Seebo formulas
nav_order: 3
---

# Actions & macros
{: .no_toc }

<details open markdown="block">
  <summary>Table of contents</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

---

Two more things a template can do: declare an **effect** (an action), and **compose or lay out**
text (macros).

## Actions

`action({ … })` declares an **external effect** — the one construct in Seebo that changes the
outside world. Crucially, evaluating a template **never runs** an action: the engine only *prepares*
a plan. Swaft executes it separately, under
[confirmation and receipts](../guide/code-and-actions.md#confirmation-execution--receipts).

An `action({ … })` formula renders to the **empty string** (an effect is not text), so you place it
where you want the effect to occur:

```text
${ action({
  id: 'save',
  type: 'myAction',          # the action template's type name
  input: { orderId: ${ id } },
  confirm: true,
  environment: 'test'
}) }
```

| Field | Meaning |
|-------|---------|
| `id` | Unique id for this action within the render. |
| `type` | Which [action template](../guide/code-and-actions.md#action-templates) handles it. |
| `input` | The values passed to the handler (may reference inputs/data). |
| `confirm` | `true` requires explicit confirmation before it can run. |
| `environment` | Target environment (`test`, `preprod`, `prod`); the sandbox forbids `prod`. |

Actions are collected **only when their branch is actually reached**, so an action behind a ternary
that isn't taken is never prepared:

```text
${ shouldSave ? action({ id: 'save', type: 'myAction', confirm: true }) : '' }
```

For the full execution model — confirmation, receipts, environments and trust — see
[Code & actions](../guide/code-and-actions.md#confirmation-execution--receipts).

## Macros

Macros use the `@{ … }` slot and come in two families.

### Composition macros

These run **before** the render and pull other templates in — useful for headers, footers and
reusable fragments, and the mechanism behind the
[Batcher](../guide/batcher-and-releases.md#the-batcher).

- **`@{ ABSORB('name') }`** — inline one template by name.
- **`@{ MERGE('glob', separator?) }`** — concatenate, in sorted order, every template whose name
  matches an anchored glob (`*` and `?` wildcards), joined by the separator.

```text
@{ ABSORB('header') }
Body for ${ name }
Footer: @{ MERGE('foot_*', ' | ') }
```

Given templates `header`, `foot_1`, `foot_2`, this assembles the header, the body, and the merged
footers. Inputs declared in the pulled-in templates flow into the same Input panel.

### Layout macros

These run **after** the render and clean up the resulting text. The most useful trick: emit a layout
marker from a formula so a line **removes itself** when a value is empty.

```text
From: noreply@acme.io
${ note != '' ? 'Note: ' + note : '@{REMOVE_LINE}' }
```

When `note` is empty, the second line disappears entirely.

| Macro | Effect |
|-------|--------|
| `@{ REMOVE_LINE }` | Delete the whole line the marker is on. |
| `@{ REMOVE_LEFT(n) }` / `@{ REMOVE_RIGHT(n) }` | Delete the marker plus *n* neighbouring characters. |
| `@{ COLLAPSE }` | Remove itself and collapse runs of blank lines. |

Unrecognized `@{ … }` text is left untouched, so ordinary content is never mangled.
