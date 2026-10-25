---
title: Capabilities
layout: default
parent: Seebo formulas
nav_order: 2
---

# Capabilities
{: .no_toc }

<details open markdown="block">
  <summary>Table of contents</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

---

A **capability** is how a formula gets a value it doesn't compute itself. Swaft exposes two kinds:

- **Widget capabilities** — declare an **input** the user fills in the Input panel.
- **Data capabilities** — resolve a value **automatically** at render time (no prompt):
  `env`, `secret`, `template` and `previous`, plus any [custom capabilities](#custom-capabilities-your-own-code).

Both are called like a producer: `name({ … })`.

## Widget capabilities (inputs)

A widget capability declares an input and picks the UI control that collects it. The **name**
chooses the widget; the argument object carries `id` (required, unique), an optional
`label`/`description`, a `type`, and — for choice widgets — `options`.

```text
Hello ${ textbox({ id: 'name', label: 'Your name', type: string() }) }!
```

| Capability | Widget | Default type |
|------------|--------|--------------|
| `textbox` | Single-line text | `string` |
| `textarea` | Multi-line text | `string` |
| `number` | Numeric | `int` (use `type: float()` for decimals) |
| `boolean` | Toggle | `bool` |
| `listbox` | Single-select | `string` |
| `multiOption` | Multi-select | `array` |
| `jsonInput` | JSON editor (+ import / drag-drop) | `object` |
| `datetimebox` | Date/time picker | `datetime` |
| `durationbox` | Duration | `duration` |

Because each widget has a default type, `type` is often optional:

```text
${ number({ id: 'qty' }) }          #{ already an int }
${ listbox({ id: 'plan', options: ['Free', 'Pro'] }) }
```

The same `id` used in more than one place (or across documents in the
[Batcher](../guide/batcher-and-releases.md#the-batcher)) is collected **once** and reused.

{: .note }
> Widget capabilities are how Swaft implements "typed inputs". Under the hood they are Seebo
> capabilities that **suspend** for user input; Swaft surfaces them as the Input panel and resumes
> the render once you fill them.

## Data capabilities

Data capabilities resolve a real value **during** the render — they never appear as inputs.

### `env(key)` — environment variables

Reads a variable from the active [environment](../guide/environments.md):

```text
${ env('BASE_URL') }/v1/orders
```

There is a shorthand: a bare `${ NAME }` that isn't otherwise defined is resolved as `env('NAME')`:

```text
${ BASE_URL }/v1/orders    #{ same as env('BASE_URL') }
```

The shorthand applies only when the slot holds **nothing but the name**. In a larger expression,
use `env('NAME')` explicitly.

### `secret(name)` — a stored secret

Reads a secret saved under **Settings → Secrets**. The value comes from the operating system's
keychain, is resolved in the backend only when needed (for example when a request is sent), and is
masked in diagnostics and audit records:

```text
Authorization: Bearer ${ secret('API_TOKEN') }
```

A name that has not been stored resolves to an empty string. See
[Security & settings → Secrets](../guide/security-and-settings.md#secrets).

### `template(ref)` — another template's content

Reads another **`json`** template in the same project and parses it into an object you can index:

```text
${ template('config').baseUrl }
${ template('config').limits.maxRetries }
```

Use it to keep shared configuration in one JSON template and reference it from many others.

### `previous(alias)` — a scenario's upstream output

Only meaningful **inside a [scenario](../guide/scenarios.md) run**: reads the output of an earlier
block. Standalone (outside a run) it resolves to an empty object, so the template stays renderable.
When the upstream block is a `json` document, its `output` is parsed into an object.

```text
${ previous('login').json.token }     #{ a field from an upstream API block }
${ previous().output }                #{ the immediate predecessor's value }
```

See [Scenarios → Passing data](../guide/scenarios.md#passing-data-with-previous) for the full output
envelope.

## Custom capabilities (your own code)

You can add your **own** data capability by writing a
[capability template](../guide/code-and-actions.md#capability-templates) — sandboxed JavaScript that
returns JSON. It is then callable from any formula by the template's name:

```text
${ myCapability({ id: 'cfg' }).baseUrl }
```

This is the supported way to extend the vocabulary available to formulas in Swaft.
