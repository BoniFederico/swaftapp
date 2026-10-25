---
title: Seebo formulas
layout: default
nav_order: 6
has_children: true
---

# Seebo formulas
{: .no_toc }

<details open markdown="block">
  <summary>Table of contents</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

---

Everywhere you can type `${ … }` in Swaft — a document body, an API URL or header, a decision
condition — you are writing a **Seebo formula**. Seebo is the template engine Swaft is built on: a
small, **typed**, **side-effect-free** expression language that always terminates.

This section is a practical reference for authoring formulas **inside Swaft**. It is organized as:

- **[Syntax & types](syntax.md)** — slots, literals, the type system, operators, `match` and methods.
- **[Capabilities](capabilities.md)** — declaring inputs with widgets, and reading data with
  `env`, `secret`, `template` and `previous`.
- **[Actions & macros](actions-macros.md)** — declaring effects, and composing/laying out text with
  macros.

## The three kinds of slot

A template is plain text with three kinds of delimited slot:

| Slot | Meaning | Example |
|------|---------|---------|
| `${ … }` | **Formula** — evaluated and its value emitted. | `Hello ${ name.upper() }` |
| `#{ … }` | **Comment** — removed from the output. | `#{ TODO: revisit }` |
| `@{ … }` | **Macro** — composition/layout directive. | `@{ ABSORB('header') }` |

Everything outside a slot is copied through verbatim.

## A worked example

```text
#{ A short order summary }
Order ${ textbox({ id: 'orderId', label: 'Order id' }) } — ${ listbox({ id: 'status', label: 'Status', options: ['open', 'shipped'] }).upper() }
Total: ${ number({ id: 'qty', label: 'Quantity' }) * number({ id: 'price', label: 'Unit price' }) } EUR
${ textarea({ id: 'note', label: 'Note' }) != '' ? 'Note: ' + note : '@{REMOVE_LINE}' }
```

- `textbox`, `listbox`, `number` and `textarea` declare **inputs**; each appears once in the Input
  panel, keyed by its `id`.
- `.upper()` calls a **method** on the string the input returns.
- `qty * price` is arithmetic on two `int` inputs; the result is formatted with the workspace locale
  when it is emitted.
- On the last line, `note` refers back to the input declared with `id: 'note'` in the same formula.
  When it is empty the formula emits a **layout macro** that deletes the line (see
  [Actions & macros](actions-macros.md#layout-macros)).

A bare whole-slot name such as `${ BASE_URL }` that is not an input is read from the active
[environment](../guide/environments.md).

## Key rules to remember

Two things surprise newcomers:

- **No implicit type coercion.** `1 + 'a'` is a `TYPE_ERROR`. Convert explicitly:
  `string(1) + 'a'`.
- **"Empty" means `''`, `[]` or `{}`** for the `??` operator — `0` and `false` are **not** empty, so
  `0 ?? 9` is `0`.

## Common errors

When a formula is wrong, Swaft shows a **diagnostic** with a stable `code` and the position in the
source. The code is the contract — read it, don't rely on the wording. The ones you'll meet most:

| Code | Meaning |
|------|---------|
| `SYNTAX_ERROR` | Malformed formula. |
| `UNDECLARED_NAME` | A name that isn't a variable, input or capability. |
| `UNKNOWN_FUNCTION` | Unknown producer / capability name. |
| `UNKNOWN_METHOD` | Method not available on that value's type. |
| `ARITY_MISMATCH` | Wrong number of arguments. |
| `TYPE_ERROR` | A provable type mismatch (e.g. `1 + 'a'`). |
| `NON_EXHAUSTIVE_MATCH` | A `match` over an open type with no `*` (default) arm. |
| `UNKNOWN_CAPABILITY` | A `require`/`need` cites a capability that isn't registered. |
| `CONSTRAINT_VIOLATION` | A value broke its own declared constraints (e.g. `max`). |
| `DIVISION_BY_ZERO` | Division by zero. |

{: .note }
> Seebo is **not Turing-complete** and has no loops or recursion beyond bounded template inclusion —
> every render terminates. Resource limits (input size, nesting, steps, time) each fail with their
> own diagnostic if exceeded.
