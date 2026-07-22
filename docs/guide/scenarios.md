---
title: Scenarios
layout: default
parent: User guide
nav_order: 6
---

# Scenarios
{: .no_toc }

<details open markdown="block">
  <summary>Table of contents</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

---

A **scenario** is a visual workflow. On a canvas you place **blocks** — API requests, actions and
capabilities — and **control nodes**, connect them with edges, and run the whole thing. Data flows
forward: each block can read the output of blocks that ran before it.

## The canvas

Open a scenario template to get the canvas. You can pan (drag the background), zoom (wheel), and
drag nodes around; positions snap to a grid so edges stay tidy.

Add blocks two ways:

- **Drag a template** from the [Working Tree](working-tree.md) onto the canvas — it becomes a block
  referencing that template.
- Use the **add** affordance on the canvas to insert a control node.

Connect nodes by dragging from a node's **output port** (right side) to another node's **input
port** (left side). The **Node inspector** (side panel) edits the selected node: its **alias**, the
template/version it points to, a decision's condition, or a delay's duration.

## Node kinds

| Kind | Purpose | Ports |
|------|---------|-------|
| **Start** | Entry point of the run. | One output, no input. |
| **Block** | Runs an **API**, **action** or **capability** template. | One input, one output. |
| **Decision** | Branches on a boolean [Seebo formula](../seebo/index.md). | One input; **two** outputs: `true` and `false`. |
| **Delay** | Waits a fixed number of milliseconds. | One input, one output. |

The graph is a **single active path**: every node except a decision has at most **one** outgoing
edge, a decision has exactly one edge per branch, and nothing connects into a start node. Deleting a
node also removes the edges touching it.

## Passing data with `previous(...)`

When a block runs, later blocks can read its output through the **`previous(...)`** data capability:

- **`previous()`** — the immediate predecessor's output.
- **`previous('alias')`** — a specific upstream block, by the **alias** you gave it in the inspector.

Every executed block is normalized to the same **output envelope**, so formulas read predictably:

```text
${ previous('login').json.token }      # a field from an API block's JSON response
${ previous('lookup').output }          # a capability block's returned value
${ previous('save').ok }                # whether an action block succeeded
```

The envelope includes `ok`, `output`, and — for API blocks — `status`, `json`, `headers`, `method`,
`url`, `durationMs` (metadata only, never used to persist bodies).

{: .note }
> `previous(...)` only carries data **during a scenario run**. If you open a template standalone
> that uses it, `previous(...)` resolves to nothing — the template stays renderable.

## Decisions

A **decision** node holds a boolean formula and follows its `true` or `false` edge accordingly:

```text
${ previous('login').status == 200 }
```

Edit the condition in the Node inspector with the same formula field used everywhere else.

## Running a scenario

The **Run panel** drives execution. A run:

1. starts at the chosen **start node** (or the graph's single start),
2. executes each block, recording a step,
3. evaluates decisions to pick a branch,
4. honours **delay** nodes,
5. stops at the end of the path, on error, or when you press **Stop**.

**Stop** is cooperative: it halts the run **between steps** (a step already in flight finishes
first).

### Attended vs. unattended (run modes)

| Mode | Behaviour |
|------|-----------|
| **single** | Attended. If a block needs an input that isn't bound, the run **pauses** and asks you to provide it, then resumes. |
| **batch** | Unattended. A missing input **fails that step** instead of prompting. Runs the scenario `count` times back-to-back (up to 1000), spaced by an inter-run delay. |

### Authorizing actions

A scenario may run several **actions** without stopping to confirm each one. Instead you give the
run **one acknowledgement** (`authorizeActions`) that authorizes its action blocks up front. The
**sandbox still applies** — `prod`-targeted actions remain forbidden unless the workspace is in dev
[execution mode](security-and-settings.md#code-sandbox--execution-mode).

## Run history

Every run is recorded on the **scenario** (not on the individual templates), in local-only history:

- a **run** record (status: running / awaiting-input / completed / failed / cancelled, timing, step
  count),
- one **step** record per executed node — redacted metadata plus a **truncated** output snapshot.
  Consistent with the rest of Swaft, **request/response bodies and action inputs are never
  stored**.

The Run panel shows live progress and lets you inspect each step and browse past runs.
