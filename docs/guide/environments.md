---
title: Environments
layout: default
parent: User guide
nav_order: 7
---

# Environments
{: .no_toc }

<details open markdown="block">
  <summary>Table of contents</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

---

An **environment** is a named set of variables — plain string values like `BASE_URL`, `REGION` or
`ACCOUNT_ID`. You keep several environments (say **Dev**, **Staging**, **Prod**) and switch the
**active** one in a click; every formula that reads a variable follows along.

{: .important }
> Environment variables are for **non-secret** configuration. Do **not** put passwords or API tokens
> in them — those belong in [secrets](security-and-settings.md#secrets), which are encrypted in the OS
> keychain. Environment values are stored as plain text in the workspace.

## Personal vs. shared

Each environment has a **scope**:

| Scope | Who sees it | Stored |
|-------|-------------|--------|
| **Workspace** | Everyone using the workspace. | In the workspace (shared). |
| **User** | Only you, on this device. | Local to your device. |

Use **workspace** environments for shared config the whole team needs, and **user** environments for
your personal overrides.

## Managing environments

Open **Settings → Environments**. There you can create environments, add key/value variables, and
edit them. The **active environment** is chosen from the **picker in the top bar** — switching it
re-resolves every `env(...)` reference across the app.

The active selection is **local to your device**, so switching environments never changes anything
for other users of a shared workspace.

## Reading variables in formulas

Read a variable with the **`env(...)`** data capability:

```text
${ env('BASE_URL') }/v1/orders
```

There is also a **shorthand**: a bare `${ NAME }` that Seebo doesn't otherwise recognize is
resolved as `env('NAME')`:

```text
${ BASE_URL }/v1/orders          # same as env('BASE_URL')
```

`env(...)` resolves during rendering and never appears in the [Input panel](document-templates.md) —
it is data, not a prompt. This works everywhere formulas do: documents, API request URLs/headers/
bodies, decision conditions, and so on.

## Writing variables from actions

[Action templates](code-and-actions.md#action-templates) can **write** environment variables with
`swaft.env.set(...)`. This is the idiomatic way to carry a value from one step to the next — for
example, a login request's **post action** stores a token that later requests read with
`${ env('TOKEN') }`:

```js
export default async function ({ api, swaft }) {
  swaft.env.set('TOKEN', api?.response?.json?.token);
  return { ok: true };
}
```

The write is committed **only if the action succeeds**, and — like all actions — it runs under
[confirmation](code-and-actions.md#confirmation-execution--receipts).
