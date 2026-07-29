---
title: Document templates
layout: default
parent: User guide
nav_order: 3
---

# Document templates
{: .no_toc }

<details open markdown="block">
  <summary>Table of contents</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

---

A **document template** turns typed inputs into rendered text — a report, an e-mail, a JSON/YAML
payload, a diagram, and so on. It is the most common template type and the best way to learn
[Seebo formulas](../seebo/index.md).

## Importing files as document templates

Drag one or more files from your OS onto the Working Tree — a folder, or the tree's empty area for
the project root — to create a document template per file, in that location. The subtype is guessed
from the file extension (`.md` → markdown, `.html` → html, `.mermaid`/`.mmd` → mermaid, `.eml` →
eml, and so on; anything unrecognized becomes plain text), and the file's content becomes the
template's source. This is the same mechanism used to run a document template as a **scenario
block** (see [Scenarios](scenarios.md#node-kinds)).

## The Document view

Opening a document template shows three areas:

```
┌──────────────┬───────────────────────────────┬───────────────────────────┐
│ Input panel  │         Output                │  Action panel (optional)  │
│              │                               │                           │
│ one widget   │  rendered document, or        │  shown only when the      │
│ per declared │  syntax-highlighted code      │  render produces actions  │
│ input        │  (depending on subtype)       │                           │
└──────────────┴───────────────────────────────┴───────────────────────────┘
```

- The **Input panel** is generated from the inputs your template declares (see below).
- The **Output** re-renders as you edit inputs. Renderable subtypes (Markdown, HTML, Mermaid…) show
  a visual preview; code subtypes show highlighted source.
- The **Action panel** appears **only if** the render declares one or more
  [actions](code-and-actions.md#action-templates).
- A **release picker** lets you view/render the draft or a specific
  [release](batcher-and-releases.md#releases).

## Declaring inputs with widgets

Inputs are declared inside `${ … }` formulas using **widget capabilities**. The capability *name*
chooses the widget rendered in the Input panel; the `type` sets how the value is validated.

The starter document is:

```text
Hello ${ textbox({ id: 'name', label: 'Your name', type: string() }) }!
```

Each input takes an object with `id` (required, unique), an optional `label`/`description`, a
`type`, and — for choice widgets — `values`.

### Widget catalog

| Widget capability | Renders | Default value type |
|-------------------|---------|--------------------|
| `textbox` | Single-line text field | `string` |
| `textarea` | Multi-line text area | `string` |
| `number` | Numeric input | `int` (use `type: float()` for decimals) |
| `boolean` | Toggle / checkbox | `bool` |
| `listbox` | Single-select dropdown | `string` |
| `multiOption` | Multi-select list | `array` |
| `jsonInput` | JSON editor with import + drag-and-drop | `object` |
| `datetimebox` | Date / time picker | `datetime` |
| `durationbox` | Duration input | `duration` |

Because each widget carries a default type, you can often omit `type` — a bare
`${ number({ id: 'qty' }) }` already validates as an integer.

### Examples

A dropdown whose choices come from the formula (no hard-coding in the UI):

```text
Plan: ${ listbox({ id: 'plan', label: 'Plan', type: string(),
                   values: ['Free', 'Pro', 'Enterprise'] }) }
```

A number and a boolean, combined in an expression:

```text
${ number({ id: 'qty', label: 'Quantity' }) } items
${ boolean({ id: 'gift', label: 'Gift wrap?' }) ? '(gift wrapped)' : '' }
```

A JSON payload built from a structured input:

```text
${ jsonInput({ id: 'payload', label: 'Body', type: object() }) }
```

See [Seebo → Capabilities](../seebo/capabilities.md) for the full input model, and
[Seebo → Syntax & types](../seebo/syntax.md) for what you can write in an expression.

## Subtypes

A document's **subtype** controls how the Output area renders it. Change it in the editor.

| Subtype | Rendered as | Notes |
|---------|-------------|-------|
| `markdown` | Formatted Markdown | Rich preview |
| `html` | Rendered HTML | Preview |
| `eml` | E-mail preview | Headers + body |
| `mermaid` | [Mermaid](https://mermaid.js.org/) diagram | Diagram from text |
| `swagger` | Swagger / OpenAPI UI | From an OpenAPI spec |
| `echarts` | [Apache ECharts](https://echarts.apache.org/) chart | From a chart spec |
| `json` | Highlighted JSON | Code |
| `yaml` | Highlighted YAML | Code |
| `csv` | Highlighted CSV | Code |
| `css` | Highlighted CSS | Code |
| `javascript` | Highlighted JavaScript | Code |
| `java` | Highlighted Java | Code |
| `text` | Plain text | Default |

{: .note }
> The rendered subtypes are `html`, `markdown`, `eml`, `mermaid`, `swagger` and `echarts`. All
> other subtypes show the generated source with syntax highlighting.

### Example: a Mermaid diagram from an input

Set the subtype to `mermaid` and use:

```text
flowchart LR
  A[Start] --> B{${ textbox({ id: 'gate', label: 'Gate label', type: string() }) }}
  B -->|yes| C[Do it]
  B -->|no| D[Skip]
```

Type a label into the input and the diagram redraws.

## Reading data with capabilities

Beyond user inputs, a document can pull in **data** that resolves automatically at render time:

- **`env('KEY')`** — a variable from the active [environment](environments.md). The shorthand
  `${ KEY }` also works.
- **`template('other')`** — the parsed content of another `json` template in the same project,
  as an object you can index: `${ template('config').baseUrl }`.
- **`myCapability({ … })`** — a value returned by one of your
  [capability templates](code-and-actions.md#capability-templates).

These never appear in the Input panel; they are filled in for you.

## Formatting & last inputs

- **Last input values** are remembered per template (locally, per device) so a document reopens
  with what you last typed.
- Formattable code subtypes (`json`, `yaml`, `html`, `css`, `javascript`, `java`, `markdown`,
  `swagger`) offer a **Format** action (powered by Prettier).

## Errors

If a formula is wrong, Swaft shows Seebo **diagnostics** with a stable code and the position in the
source — e.g. `UNDECLARED_NAME`, `TYPE_ERROR`, `ARITY_MISMATCH`. See
[Seebo → Troubleshooting](../seebo/index.md#common-errors) for what each means.
