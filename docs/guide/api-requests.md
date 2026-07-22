---
title: API requests
layout: default
parent: User guide
nav_order: 4
---

# API requests
{: .no_toc }

<details open markdown="block">
  <summary>Table of contents</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

---

An **API template** is a structured HTTP request. Swaft has a real HTTP client that runs in the
backend — requests are a proper request model, never cURL strings, and every field can contain
[Seebo formulas](../seebo/index.md).

## The API view

```
┌───────────────────────────────────────────────────────────────────────┐
│ GET ▾   https://${ BASE_URL }/users/${ id }              [ Send ]      │
├───────────────────────────────────────────────────────────────────────┤
│ Params · Headers · Body · Auth · Actions · Info · Input   ← request     │
├───────────────────────────────────────────────────────────────────────┤
│ Response: status · time · size · Body · Headers · Render · History      │
└───────────────────────────────────────────────────────────────────────┘
```

- The **method** (subtype) is one of `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`.
- **Params / Headers** are structured key/value editors.
- **Body** supports `none`, `json`, `form`, `text`, `xml`.
- **Auth** attaches credentials (below).
- **Actions** are pre/post automations (below).
- **Send** runs the request through the backend and shows the response.

## Formulas in requests

Any field — URL, params, headers, body — can use `${ … }`. Formulas are rendered **server-side just
before the request is sent**, so you can:

- pull environment variables: `https://${ BASE_URL }/v1/orders`
- build a body from inputs or upstream data:

  ```json
  { "token": "${ env('API_TOKEN') }", "region": "${ REGION }" }
  ```

The **Input** tab exposes any widget inputs the request declares, exactly like a document's Input
panel, so a request can prompt for values before it runs.

## Authentication

The **Auth** tab supports:

| Type | Sends |
|------|-------|
| **None** | No auth. |
| **Bearer** | `Authorization: Bearer <token>`. |
| **Basic** | `Authorization: Basic <base64(user:pass)>`. |
| **API key** | A key in a **header** or **query parameter** you name. |

{: .important }
> Enter secret values as **secrets**, not as plain text. Swaft stores them in the OS keychain and
> keeps only an opaque reference in the workspace — the secret is never written to the `.swaft`
> file or Git repo, and never shown back to the UI in clear. See
> [Security & settings](security-and-settings.md#secrets).

## Sending & the response

Pressing **Send** routes the call through the backend HTTP client. The response area shows the
**status**, **duration**, **size**, the **body** (pretty-printed / highlighted), the **headers**,
and a **Render** view for previewing the body (e.g. as JSON or HTML).

Outbound requests are subject to the workspace's **blocked-domain list** and any **enforced
headers** — see [Restrictions](security-and-settings.md#restrictions).

## History

Each API template keeps its own **call history** (local to your device). History is
**metadata-only** — method, URL, status, timing — and **never** stores request or response bodies.
You can delete individual records or clear the whole history for a template.

## Inheriting from folders

A folder that contains API templates acts as an **HTTP collection**. It can define shared policy
that requests inside it **inherit**:

- common **headers**,
- a **proxy**,
- default **authentication**,
- **pre/post actions**.

In a request, set the relevant setting to **inherit** to pick up the folder's value (folders nest,
so the policy propagates down the chain). This lets you configure a base URL header, an auth scheme
or a proxy once per collection instead of per request. Edit the policy from the
[folder's detail view](working-tree.md#folders).

## Request actions (automation)

The **Actions** tab attaches [actions](code-and-actions.md#action-templates) that run around the call:

- **pre** actions run **before** the request is sent — e.g. fetch or refresh a token and write it
  to an [environment](environments.md) variable;
- **post** actions run **after** a response arrives — e.g. extract a value from the response and
  store it for the next request.

Actions see the request/response and, like everywhere, run under
[confirmation and receipts](code-and-actions.md#confirmation-execution--receipts). This is also how
API blocks pass data along inside a [scenario](scenarios.md).

## Security notes

- Every call executes in the **backend**, never directly from the UI.
- The blocked-domain check is re-evaluated on **each redirect** (max 5), which blunts SSRF-style
  redirect tricks.
- In production builds, a folder proxy routes the request through Electron's proxied session.
