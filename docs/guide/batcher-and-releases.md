---
title: Batcher & releases
layout: default
parent: User guide
nav_order: 8
---

# Batcher & releases
{: .no_toc }

Two ways to work with more than one version or document at a time.
{: .fs-6 .fw-300 }

<details open markdown="block">
  <summary>Table of contents</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

---

## The Batcher

The **Batcher** renders several **document templates together** into one combined output. Open it
from the top bar; it appears as a panel under the Working Tree.

- **Drag document templates** into the batcher, in the order you want them combined. Order is
  significant.
- **Shared inputs are resolved once.** If several documents declare an input with the same `id`, you
  fill it a single time and the value is reused across all of them.
- **Merge macros apply.** Templates can pull each other in with Seebo's
  [`ABSORB` / `MERGE`](../seebo/actions-macros.md#composition-macros) aggregator macros, so the batch
  can assemble a single composite document.
- Only **document** templates are accepted — API, code and scenario templates cannot be batched.

The Batcher is a **transient composition tool**: it is not itself a saved, versioned object.

{: .note }
> A workspace admin can turn the Batcher **off** in
> [Settings → Restrictions](security-and-settings.md#restrictions).

## Releases

A **release** is a named, saved version of a single template, with a **changelog**. Releases let you
keep a stable version around while you continue editing.

### The draft and releases

Every template has an editable **Draft**. From the editor you can:

- **Create a release** — snapshot the current draft under a name/version.
- **Update a release** — releases are **editable in place** in this build, so you can correct a
  saved version without cutting a new one.
- **Delete a release** — remove one you no longer need. (You can even delete the Draft, leaving only
  releases.)
- **Changelog** — record what changed; the changelog is common to all template types.

### Selecting which version you use

**Release selection** decides which version a template renders/executes as. It is set from the
Working Tree's **Select release** menu and is:

- **per template**, and
- **personal and local to your device** — your selection never changes what anyone else sees in a
  shared workspace.

If you haven't chosen one, Swaft falls back to the **latest release**, or the **Draft** when there
are no releases. The **release picker** inside a template's view lets you preview any version on the
spot.

{: .tip }
> Because release selection is per-device, two people can pin **different** releases of the same
> shared template — useful when one is validating a new version while another keeps using the stable
> one.
