# Scenarios — Technical Feasibility Study & Design Spec

> Status: **draft / design baseline**. This document is the study requested before building the new
> `scenario` template type (a visual, low‑code workflow canvas à la n8n). It grounds every claim in
> the current codebase (file:line references verified against the working tree), evaluates the idea
> critically, proposes better alternatives where the original sketch has sharp edges, and lays out a
> phased implementation plan intended to guide the actual development (Copilot).
>
> Written in English to match the existing specs under `docs/swaft/` and the code symbols it points at.

---

## 1. What a Scenario is

A **Scenario** is a new template type whose "source" is not text but a **directed graph** of blocks
that execute in sequence. Blocks wrap the app's three *executable* template kinds:

- **API** templates (an HTTP request),
- **Action** templates (a sandboxed side‑effecting Seebo action),
- **Capability** templates (a sandboxed pure function returning a value).

Plus **control nodes**: a **Start** node, **Decision** diamonds (branch on a boolean Seebo formula),
and **Delay** nodes. Blocks are wired by **edges** that define execution order; a decision node's two
outgoing edges are the `true` / `false` branches.

Data flows forward: when a block runs inside a scenario, later blocks can read earlier blocks' outputs
through a new Seebo data capability, **`previous(...)`**. A scenario **run** records a unified history
(every API call, action receipt and capability result) **on the scenario**, not on the individual
templates.

**Verdict up front:** the feature is **feasible without any new npm dependency**, and it slots cleanly
into existing extension points. The two genuinely *greenfield* pieces are (a) the visual canvas (no
graph library is available — see §4) and (b) a sequential execution engine with run history (the
Batcher is *composition*, not *sequenced execution* — see §3.3). Everything else reuses machinery that
already exists. Effort is dominated by the canvas and the runner; the risky/uncertain areas are
cancellation granularity, unattended‑action policy, and durable scheduling (§8).

---

## 2. How the current architecture supports this

### 2.1 A new template type is cheap to add

`type` is a plain `TEXT` column with **no `CHECK` constraint** (`apps/desktop/src/main/storage/schema.ts`
templates DDL, `type TEXT NOT NULL, subtype TEXT`), and a scenario's graph can be stored as **JSON in the
existing `source` column** — exactly how `api` templates store their `HttpRequestModel`
(`ApiView.tsx` `parseRequest()` / `save()` → `JSON.stringify(req)` into `template.updateSource`). So:

- **No DB migration is needed for the type itself.**
- **No new op is needed to store/load a scenario** — `template.create` and `template.updateSource`
  already carry arbitrary `source` + `type`.
- The type flows from one enum (`templateTypeSchema` in `packages/shared/src/ops.ts:226`) into the
  Working Tree, the create dialog, and the tab router; TypeScript's exhaustive `Record<TemplateType, …>`
  maps (`SUBTYPES`, `DEFAULT_SUBTYPE`) will *force* every spot to be filled.

The tab host (`workspace/WorkspaceView.tsx`) already dispatches a full‑tab view per `type`
(`ApiView` / `CodeView` / `DocumentView`); adding a `scenario` branch that mounts a new
`ScenarioView` is the intended extension pattern. Views receive `{ client, templateId, onDirtyChange,
onTitleChange }` — dirty tracking and title sync come for free.

Because a scenario **is** a template, it also gets **releases/versioning for free** (the release
listbox and `release.update` mechanism) — useful for pinning a stable graph.

### 2.2 Seebo already separates "resolved data" from "user input"

The single most important enabling fact for `previous(...)`:

- `SeeboHost.engine(policy, ctx)` **rebuilds the whole capabilities map and a fresh engine on every
  analyze/validate/render** (`apps/desktop/src/main/seebo/SeeboHost.ts:203-285`). There is no long‑lived
  engine to mutate.
- A per‑render **context** already exists: `SeeboRenderContext = { projectId, templateId }`
  (`SeeboHost.ts:79-83`), threaded through `analyze`/`render` and captured by capability closures
  (e.g. `template` reads `ctx?.projectId`).
- **Data capabilities** (`DATA_CAPABILITIES = ['template', 'env']`, `packages/shared/src/ops.ts:799`)
  resolve a *real value inline during the drive loop* and are **pruned from the Input panel**
  (`RenderService.ts:43-46` via `SeeboHost.dataCapabilityNames()`). Widgets, by contrast, resolve to
  `undefined` and surface as `pending` requirements.

So `previous(...)` is a textbook **data capability**: register it in `SeeboHost.engine`, keyed off an
extended `SeeboRenderContext` that the scenario runner fills with prior block outputs, and add it to
`DATA_CAPABILITIES`. A value it resolves never appears in `pending` — precisely the semantics the idea
needs. (Details and refinements in §5.)

### 2.3 Per‑step executors already exist

A scenario runner does **not** need to reimplement request/action/capability execution:

| Block kind | Existing primitive | Returns |
|---|---|---|
| API | `ApiRunService.send(templateId, request, values)` (`workspace/ApiRunService.ts:39`) — resolves formulas, runs pre/post actions, sends, records history | `{ response, rendered?, request?, actions? }` (`HttpSendResponse`) |
| Action | `ActionService.execute(templateId, { confirmedActions, failFast, dryRun })` (`actions/ActionService.ts:44`) — re‑renders the authoritative plan server‑side, executes with policy/redaction | `ReceiptDto[]` |
| Capability | `UserCodeRegistry.runOnce(templateId, args, { dryRun })` (`usercode/UserCodeRegistry.ts:175`) | `{ value, durationMs, logs, envWrites }` |

The scenario runner lives **in main** and calls these services directly, so it can pass an **extended
render context** without threading scenario state through any IPC op.

### 2.4 Drag‑and‑drop, pointer interaction and editors are already in the codebase

- The Working Tree drags a template with MIME `application/swaft-template`, payload
  `{ id, name, type }` (`WorkingTree.tsx` drag source; `batcher/BatcherView.tsx` drop target). A canvas
  reuses the same drop protocol, mapping `clientX/Y − canvasRect` to a node position.
- Pointer‑drag loops with `window` `pointermove`/`pointerup` are used twice already
  (`WorkspaceView.tsx` side resize; `document/useDocLayout.ts` `startDrag` with **localStorage
  persistence**) — the exact pattern for dragging nodes and drawing edges.
- Seebo formula fields (`editor/SeeboField.tsx`, with hover‑preview) and the CodeMirror 6 editor
  (`editor/CodeEditor.tsx`) are self‑contained controlled components — reused verbatim for decision
  conditions and node config.

---

## 3. Critical evaluation of the proposal (and better alternatives)

The core idea is sound. Below are the points where the original sketch needs sharpening, with the
recommended alternative.

### 3.1 `previous[...]` positional access → **`previous('alias')` named access**

**Concern.** Indexing previous blocks positionally (`previous[0]`, `previous[-1]`) is brittle: it
breaks when the graph is reordered, when a decision skips a branch, or when fan‑in merges paths.

**Recommendation.** A **function‑form data capability** with **named** references:

- `previous()` → the output envelope of the **immediate predecessor** on the taken path.
- `previous('alias')` → the output of a specific upstream node, where `alias` is a **user‑assigned,
  stable node label** (defaulting to a slug of the template name, editable in the node inspector).
- Optional: `previous('alias').json.items[0].id` etc. — the envelope is a plain object, so normal
  Seebo member access works.

Named refs survive reordering and make formulas readable. Positional access can still be offered as
sugar later, but the durable identifier is the alias, not the position.

### 3.2 Blocks with heterogeneous outputs → **one canonical output envelope**

**Concern.** API returns an HTTP response, capability returns a bare value, action returns a receipt.
If `previous(...)` returns three different shapes, formulas become unpredictable.

**Recommendation.** Normalize every executed block to a **canonical envelope**:

```ts
interface BlockOutput {
  kind: 'api' | 'action' | 'capability' | 'decision' | 'delay';
  ok: boolean;                 // step succeeded
  output: unknown;             // capability value | action output | (api: see below)
  // API-specific, present when kind==='api':
  status?: number; statusText?: string; headers?: Record<string,string>;
  body?: string; json?: unknown; durationMs?: number;
  // action-specific:
  logs?: string[]; envWrites?: string[];
  error?: string | null;
}
```

`previous('http1').json`, `previous('cap1').output`, `previous('act1').ok` all read predictably.
Document this envelope in the spec so Seebo formula authors have a stable contract.

### 3.3 "Reuse the Batcher" → **the Batcher is composition, not execution**

**Concern.** The Batcher (`workspace/BatcherService.ts`) looks like multi‑template orchestration but is
**document‑only** and merges templates into **one combined render pass** (`ABSORB('t0')…`), with shared
input values — no per‑step execution, no ordering‑with‑side‑effects, no data passed step‑to‑step, no
history. It cannot run API/action/capability templates.

**Recommendation.** **Reuse the Batcher's UX patterns** (ordered drop‑list, position badges, requirement
dedup) but build a **new sequential runner** (`ScenarioService`) for execution. Do not try to extend
`BatcherService`.

### 3.4 History "on the individual call" → **history on the scenario run (requires a refactor)**

**Concern.** The user explicitly wants a scenario's call history to live on the **scenario run**, not on
each API/action template. But today `ApiRunService.send` **bakes `history.record(...)` into the send**,
and `api_history` / `api_action_runs` / `receipts` are **all hard‑keyed by `template_id`** with no notion
of a "run".

**Recommendation.** Introduce a **run‑scoped history** owned by the scenario (§6), and give the send path
a way to **not** pollute the per‑template history when invoked inside a scenario. Concretely: add an
optional `historySink` (or a `scenarioRunId`) parameter to `ApiRunService.send` so, in scenario mode, it
records the step to the scenario run instead of the template's `api_history`. This is the one real
refactor of existing code the feature requires — flag it clearly for review.

### 3.5 "Interrupt a run" → **cooperative cancellation only, initially**

**Concern.** There is **no `AbortSignal` plumbed into `HttpService.send`/`fetchFn`**, and the usercode
runtime **cannot be interrupted mid‑execution** (`UtilityProcessRuntime.ts:32` comment; only a per‑call
timeout exists). So "stop the run" cannot instantly kill an in‑flight HTTP request or a running script.

**Recommendation, phased:**
- **MVP:** *cooperative* cancellation — the runner checks a `cancelled` flag **between steps**; a Stop
  button flips it. Clean, no new plumbing. Worst case: the current step finishes, then the run stops.
- **Later:** thread an `AbortSignal` from the runner into `HttpService.send`'s `fetch` to cancel
  in‑flight HTTP. Script interruption stays bounded by the existing per‑call timeout (a hard kill of the
  utility process is a separate, larger change — out of scope).

### 3.6 "Schedule 100 runs" → distinguish **in‑session repetition** from **durable scheduling**

**Concern.** Two very different features are bundled here, and one of them fights the desktop model:

- *In‑session batch* ("100 runs spaced by X seconds, now"): trivial — a loop with `await delay(ms)`.
- *Durable/cron scheduling* ("run this every night"): there is **no scheduler, timer loop, or job queue
  anywhere in main** (only two `setTimeout` watchdogs). And a desktop app **is not a daemon** — it cannot
  run a schedule while closed.

**Recommendation.**
- **Ship in‑session batch first** (repeat count + inter‑run delay + optional inter‑step delay).
- **Durable scheduling** (survives restart, fires while the app is *open*) is a later phase: persist job
  definitions in `AppStore` (`app-store/AppStore.ts`, a local‑only JSON doc) and add a small scheduler
  started in `bootstrapWorkspace`. Be explicit in the UI that schedules only fire while the app runs;
  true background execution would need an OS‑level agent (out of scope).

### 3.7 Real‑time per‑node progress → **poll first, push later**

**Concern.** The transport is **strict request/response**; the preload exposes **only** `invoke(op,
payload)` and deliberately never exposes `ipcRenderer.on`. There is **no `webContents.send` anywhere**.
Streaming per‑node progress therefore needs a brand‑new push channel + a preload surface change.

**Recommendation.**
- **MVP:** `scenario.run` returns a `runId` immediately; the runner writes per‑step rows to the
  local‑only run table as it goes; the renderer **polls** `scenario.runStatus(runId)` (e.g. every
  300–500 ms) and renders progress from the DB. Reuses strict req/resp, no security‑surface change.
- **Later:** add a dedicated, allow‑listed event channel (`webContents.send('swaft:events', …)` +
  preload `onEvent(cb)` with unsubscribe) for smooth live progress. Keep it a *fixed, validated* channel,
  mirroring the op allow‑list discipline.

### 3.8 Scenario as a template type vs. a separate entity → **template type + a run table**

**Recommendation.** Model the scenario **as a template type** (reuse tree, tabs, create dialog, drag,
source storage, releases). Add **only** a separate **local‑only run‑history table** keyed by the scenario
template id. A separate top‑level entity would duplicate a great deal of plumbing for no gain.

### 3.9 Graph semantics → **DAG‑with‑decisions, single active path, bounded**

**Concern.** n8n allows loops, parallel branches and merges; unbounded, these invite infinite loops and
complex scheduling.

**Recommendation for MVP:**
- **Single active path** driven by edges; a **Decision** node picks exactly one outgoing branch
  (`true`/`false`). Non‑decision nodes have exactly one outgoing edge.
- **Loops allowed but bounded** by a hard **max‑steps** cap per run (config, default e.g. 1000) to
  guarantee termination.
- **Fan‑out / parallel branches and fan‑in merges → later.** Start sequential; it covers the stated use
  cases (sequences of actions with conditional direction).
- **Start node selection:** the run begins at a chosen node (default: the unique `start`, or a
  user‑picked node) — trivial with the single‑path model.

---

## 4. The canvas: how to build it with zero new dependencies

**Hard constraint (verified).** The dev environment is **offline** and *"the design must not depend on a
new npm dependency"* (`analisi_codice_utente.md:186-188`; same class of failure as the blocked `@dnd-kit`
install). Consequently:

- **React Flow / `@xyflow`: not available** and cannot be installed.
- **echarts (present) and mermaid (present) are render‑only** — they draw a graph from a declarative
  source and **do not emit an edited graph model**. Wrong tool for an editor.
- **cytoscape 3.34 exists only *transitively*** (via mermaid). Depending on a transitive dep is brittle
  (a mermaid bump could drop/upgrade it), it lacks an installed edge‑drawing extension, and diamond
  shapes need custom work anyway. **Avoid.**

**Decision: build a bespoke canvas from native SVG + HTML + pointer events + React state.** This is well
precedented in the repo (§2.4). Concrete shape:

- **Layers.** A pannable/zoomable `<div>` "world" containing: (1) an absolutely‑positioned `<div>` per
  node (so node bodies can embed `SeeboField`/`CodeEditor` and normal DOM), and (2) an `<svg>` overlay
  for **edges** (`<path>` Bézier curves) and **decision diamonds** (`<polygon>`), sharing the same
  transform.
- **Interactions** via the existing `onPointerDown` + `window pointermove/pointerup` loop: drag a node,
  rubber‑band a new edge from a node's output port to another node's input port, marquee‑select, pan
  (drag empty canvas), zoom (wheel → scale the world transform).
- **Palette → canvas drop:** `onDragOver`/`onDrop` reading `application/swaft-template`, converting
  `clientX/Y − canvasRect` (÷ zoom) to a world position — mirrors `BatcherView.onDrop`.
- **Add‑without‑drag:** a "＋ Add block" affordance opening a searchable template picker (so blocks can
  be added from the editor, not only by dragging from the tree). Reuse the tree's data via `tree.get`.
- **Node inspector:** a side panel for the selected node — alias, referenced template + version, delay
  ms, or (decision) the boolean Seebo condition via `SeeboField`.
- **Persistence:** node positions + graph model serialize into the template `source` JSON; view‑only
  niceties (last pan/zoom) can go to `localStorage` per project, like `useDocLayout`.

**What must be written from scratch (all tractable, no deps):** the graph data model + serialization,
edge hit‑testing/routing (Bézier control points from port positions), pan/zoom transform math, and
selection. **No auto‑layout library is available** (no dagre/elk) — MVP uses manual positioning; a simple
"tidy vertical layout" heuristic can be added later in plain code.

> **Alternative worth keeping in reserve:** a **linear/list editing mode** (an ordered list of steps with
> inline "if" branches), reusing the Batcher's ordered‑list UX. It is dramatically cheaper than a canvas
> and could ship as an early, usable increment (and remain as an accessibility‑friendly alternate view).
> The canvas is the headline feature, so it should still be built — but the list mode de‑risks Phase 1
> and gives users something functional before the canvas is polished.

---

## 5. Data flow: the `previous(...)` data capability

### 5.1 Registration

- Extend `SeeboRenderContext` (`SeeboHost.ts:79-83`) with an optional
  `scenario?: { outputs: Record<string /*alias|nodeId*/, BlockOutput>; previousAlias: string | null }`.
- In `SeeboHost.engine(...)` (`SeeboHost.ts:216-246`, where `template`/`env` are wired), register:

  ```ts
  capabilities.previous = (req) => {
    const s = ctx?.scenario;
    if (!s) return null;                       // renderable standalone → resolves to null
    const ref = previousRef(req);              // args.ref / id / undefined
    return ref ? (s.outputs[ref] ?? null)
               : (s.previousAlias ? s.outputs[s.previousAlias] ?? null : null);
  };
  ```

- Add `'previous'` to `DATA_CAPABILITIES` (`ops.ts:799`) so the renderer prunes it from the Input panel
  and `dataCapabilityNames()` treats it as data (never `pending`).
- For the **execution** side (actions), the same outputs map can additionally be injected via
  `SeeboExecuteContext.clients` (`seebo-module.ts:113`) so action handlers can read prior outputs.

### 5.2 Standalone editing must not break

A template using `previous(...)` is also opened standalone (in `ApiView`/`DocumentView`). With no
scenario context the capability **resolves to `null`** — the template stays renderable, no hard error.
The editor should surface a **soft hint** ("`previous()` only carries data during a scenario run"), not a
blocking diagnostic. (Because `previous` is a data capability, it is already excluded from the Input
panel.)

### 5.3 How a block's inputs get satisfied at run time

When the runner executes a block, it renders that template's formulas with a `ctx.scenario.outputs`
populated from already‑executed nodes. A field like `${ previous('login').json.token }` resolves inline
(never `pending`), exactly as `env(...)`/`template(...)` do today. Any **remaining true user inputs** stay
`pending` — the runner must decide policy for those: use the template's **saved input state**
(`inputState.get`, already how `ActionService` renders — `ActionService.ts:49`), and/or let the scenario
node pre‑bind them. **Recommendation:** a scenario block uses the referenced template's saved input state
as defaults, overridable per node; if a required input is still unresolved at run, the step **fails with a
clear diagnostic** (no interactive prompt mid‑run).

### 5.4 Decision nodes

A decision node stores a **boolean Seebo formula** (e.g. `${ previous('http1').status == 200 }`). The
runner renders just that slot with the scenario context (a single‑slot render, like
`render.renderSource`), coerces the result to boolean, and follows the `true` or `false` outgoing edge.
Reuse `SeeboField` for editing (with hover preview) so authors get the same formula UX as everywhere else.

---

## 6. Persistence & run history

### 6.1 Graph definition — synchronized (🟢)

Stored as JSON in the scenario template's `source` (no new table, no migration). Suggested shape:

```jsonc
{
  "version": 1,
  "nodes": [
    { "id": "n1", "kind": "start", "position": { "x": 40, "y": 120 } },
    { "id": "n2", "kind": "template", "ref": "<templateId>", "templateType": "api",
      "alias": "login", "version": "draft", "position": { "x": 220, "y": 120 },
      "inputs": { /* per-node overrides of saved input state */ } },
    { "id": "n3", "kind": "decision", "alias": "ok?",
      "condition": "${ previous('login').status == 200 }", "position": { "x": 460, "y": 120 } },
    { "id": "n4", "kind": "delay", "ms": 2000, "position": { "x": 700, "y": 60 } }
  ],
  "edges": [
    { "id": "e1", "from": "n1", "to": "n2" },
    { "id": "e2", "from": "n2", "to": "n3" },
    { "id": "e3", "from": "n3", "to": "n4", "branch": "true" },
    { "id": "e4", "from": "n3", "to": "n5", "branch": "false" }
  ]
}
```

Because the scenario is a template, **releases/versioning apply to the whole graph** for free.

### 6.2 Run history — local‑only (🔵), owned by the scenario

Mirror the `receipts` / `api_action_runs` local‑only pattern (no sync metadata; raw
`adapter.run` INSERTs). Add to `LOCAL_ONLY_TABLES` and a single migration `to: 25` (bump
`SCHEMA_VERSION` to 25):

- **`scenario_runs`**: `id`, `scenario_id` (= scenario template id), `started_at`, `finished_at`,
  `status` (`running`|`completed`|`failed`|`cancelled`), `start_node_id`, `step_count`, `error`.
- **`scenario_run_steps`**: `id`, `run_id`, `seq`, `node_id`, `alias`, `kind`, `status`,
  `started_at`, `duration_ms`, and a **redacted** summary — for API steps `method`/`url`/`status`
  (metadata‑only, never bodies, matching the existing `api_history` security stance); for actions the
  receipt status/message; a **truncated** output snapshot for display. Follow the redaction rule
  already used by `ActionService.persist` (inputs never stored; output is what the author's block
  returned and the user asked to see).

New DTOs (`ScenarioRunDto`, `ScenarioRunStepDto`) modeled on `ApiHistoryItem` / `ReceiptDto`.

> **Design note on history relocation:** in scenario mode the API step is recorded to
> `scenario_run_steps`, **not** to the template's `api_history`. This is the refactor from §3.4 — give
> `ApiRunService.send` an optional sink so it records to the scenario run instead of the per‑template
> history. Standalone sends are unchanged.

### 6.3 Editing model — a scenario is a normal, editable template (dual surface)

**Yes: a scenario is stored and edited exactly like every other template — its `source` is
editable JSON, openable, versionable, syncable and diffable — with the graph editor as the primary
surface and raw‑JSON editing available as the power/fallback path.** This mirrors how `api` templates
work today, and it is a *free* property of storing the graph as JSON‑in‑`source` rather than in a
bespoke store.

Two edit surfaces, both writing the same `source` (verified against the current API behaviour):

1. **`ScenarioView` (the visual canvas)** — the primary, structured editor. Opening the template
   (single‑click tab) mounts the canvas; it keeps the graph in memory and `JSON.stringify`s it into
   `source` via `template.updateSource` — *identical* to how `ApiView.save()` serializes the
   `HttpRequestModel`.
2. **The Template Editor modal (`TemplateEditorModal`)** — reached by the same double‑click that opens
   the raw editor for any template. It is **type‑generic**: it edits `source` as text through CodeMirror
   using `SUBTYPES[tpl.type]` and saves with `template.updateSource` (`TemplateEditorModal.tsx:160`).
   Because a scenario's subtype is `json`, this gives **syntax‑highlighted, prettier‑formattable raw
   graph JSON** out of the box — the exact same experience an `api` template gets when you double‑click
   it (a JSON request with a Format button). No extra work is needed for this surface; it comes for free
   once `SUBTYPES['scenario'] = ['json']`.

**Seebo formulas live *inside* the graph JSON, as string fields — the same as API.** An `api`
template's JSON carries `${ … }` formulas in `url`/`headers`/`body`; a scenario's JSON carries them in
its own string fields:

- a **decision node**'s `condition` (`"${ previous('login').status == 200 }"`),
- a **template node**'s `inputs` overrides that bind a block input to upstream data
  (`"token": "${ previous('login').json.token }"`).

So the whole scenario — topology *and* the formulas that wire data between blocks — is one
human‑readable, hand‑editable JSON document. It participates in **releases/versioning** like any
template (the release listbox + `release.update`), syncs as a 🟢 entity, and diffs cleanly in git‑style
review.

**One required safeguard (parity with `parseRequest`).** Because the JSON can be hand‑edited (and a
half‑typed graph can be transiently invalid), the canvas's `parseGraph(source)` must be **defensive**:
on malformed/mismatched JSON it falls back to a safe empty/last‑good graph and surfaces a diagnostic
rather than throwing — exactly how `ApiView.parseRequest()` (`ApiView.tsx:62-76`) tolerates a bad source
today. The canvas should also avoid clobbering a source it could not parse (don't auto‑serialize an empty
graph over a file the user was hand‑editing) — treat an unparseable source as read‑until‑fixed.

**Net:** nothing special is needed to make a scenario "a real template." The JSON‑in‑`source` decision
(from §2.1) *is* what buys openable/editable/versionable/dual‑surface behaviour; the only new code is the
canvas that renders and mutates that JSON, plus a defensive parser.

---

## 7. Execution engine (`ScenarioService`, main process)

A new service constructed in `bootstrapWorkspace` (after its deps) and exposed via
`serviceSlot('ScenarioService')` in `services.ts`. It reuses `ApiRunService`, `ActionService`,
`UserCodeRegistry`, `RenderService`, `ReleaseService`, `SettingsService`.

**Run algorithm (single active path, bounded):**

```
run(scenarioId, opts):
  runId = newRun(scenarioId, opts.startNodeId)          # writes scenario_runs row
  outputs = {}                                          # alias/nodeId -> BlockOutput
  node = opts.startNodeId ?? uniqueStartTarget(graph)
  steps = 0
  while node and not cancelled(runId) and steps < MAX_STEPS:
    if node.kind == 'delay': await delay(node.ms); record; node = next(node); continue
    if node.kind == 'decision':
      b = coerceBool(renderCondition(node.condition, ctxWith(outputs)))
      record(runId, node, b); node = edgeFrom(node, branch=b); continue
    env = executeBlock(node, ctxWith(outputs))          # api|action|capability primitive
    outputs[node.alias ?? node.id] = env
    record step(runId, node, env)                       # → scenario_run_steps
    if not env.ok and opts.stopOnError: fail(runId); break
    if opts.stepDelayMs: await delay(opts.stepDelayMs)
    node = next(node)
    steps++
  finish(runId, status)
```

- `ctxWith(outputs)` = extended `SeeboRenderContext` with `scenario.outputs` + `previousAlias`.
- `executeBlock` dispatches on `node.templateType` to `ApiRunService.send` /
  `ActionService.execute` / `UserCodeRegistry.runOnce`, normalizing each result into a `BlockOutput`
  (§3.2). The referenced template version is `node.version` (draft or a release id).
- **Cancellation:** cooperative between steps via a `cancelled(runId)` flag flipped by a
  `scenario.stop` op (§3.5).
- **Batch/repeat:** wrap the whole `run(...)` in an outer loop: `repeat` count with `interRunDelayMs`.
- **Concurrency:** reuse `WorkspaceService`'s serialization discipline; disallow two overlapping runs of
  the same scenario (or queue them) to avoid interleaved DB writes.

**Security / unattended execution (§9).** Actions normally require per‑action human confirmation
(`confirmedActions`). A scenario runs many actions unattended, so it needs a **scenario‑level
authorization**: the run either pre‑confirms the action nodes it contains, or requires an explicit
"allow actions in this run" acknowledgement. **Sandbox policy is unchanged and still enforced**:
`settings.executionMode !== 'dev'` forbids `prod` (`allowedEnvironments: ['test','preprod']`,
`ActionService.ts:54-64`); receipts stay redacted.

---

## 8. Constraints, risks & open questions

| # | Risk / constraint | Severity | Mitigation |
|---|---|---|---|
| R1 | **No graph library; offline, no new deps** (`analisi_codice_utente.md:186-188`) | High (effort) | Native SVG canvas (§4); optional list mode to de‑risk Phase 1 |
| R2 | **Mid‑flight cancellation impossible today** (no AbortSignal; runtime uninterruptible) | Medium | Cooperative between‑step stop first; AbortSignal into `HttpService` later |
| R3 | **History is per‑template; needs a run‑scoped store + a `send` refactor** | Medium | New local‑only run tables; optional history sink on `ApiRunService.send` (§3.4) |
| R4 | **No streaming main→renderer** (preload exposes only `invoke`) | Medium | Poll the run table for MVP; add an allow‑listed event channel later (§3.7) |
| R5 | **No scheduler; desktop app is not a daemon** | Medium | In‑session batch first; durable (app‑open) scheduling via `AppStore` later; be explicit it won't fire while closed |
| R6 | **`previous()` couples a template to a scenario** (templates stop being self‑contained) | Medium | `previous()` resolves to `null` standalone; soft hint, not a hard error (§5.2) |
| R7 | **Unattended action execution bypasses per‑action confirmation** | Medium (security) | Scenario‑level authorization; keep sandbox `prod` ban + receipt redaction (§9) |
| R8 | **Infinite loops / runaway runs** | Medium | `MAX_STEPS` cap; single active path; bounded loops |
| R9 | **Referenced template deleted / moved / wrong project** | Low | Validate refs on load + before run; show broken‑node state |
| R10 | **Large graphs in `source`** (200k char cap on source) | Low | Adequate for realistic graphs; monitor; could raise the Zod cap if needed |

**Open questions to confirm before/along the build:**

1. **Loops & parallelism:** is single‑active‑path + bounded loops acceptable for v1, deferring
   parallel/merge? (Recommended: yes.)
2. **Which template version runs** per node — always the node's selected release, or the referenced
   template's own `releaseSelection`? (Recommended: per‑node pin, default = template's current selection.)
3. **Unresolved inputs at run:** fail the step vs. skip vs. use empty. (Recommended: fail with a clear
   diagnostic; no interactive prompt mid‑run.)
4. **Scenario‑level action confirmation** model (pre‑confirm all vs. one acknowledgement per run).
5. **Cross‑project block references** allowed, or same‑project only (as `template()` data capability is)?
6. **Does an API step inside a scenario also appear in that API template's own history**, or only in the
   scenario run? (User said scenario‑only — confirm; drives §3.4.)

---

## 9. Security model notes

- **Sandbox unchanged.** The scenario runner must call `ActionService`/the host with the same policy it
  uses today: `sandbox = executionMode !== 'dev'` → `policy.allowedEnvironments = ['test','preprod']`
  (prod forbidden unless dev mode). Never widen this for scenarios.
- **Receipts stay redacted at rest** (status + message only); fresh output is returned in‑response and
  stored **truncated/redacted** in `scenario_run_steps` following `ActionService.persist`'s rule.
- **API history stays metadata‑only** (never bodies) — the scenario step store keeps the same stance.
- **Untrusted user code** (capabilities/actions authored elsewhere) is already gated by the trust model
  (`UserCodeRegistry.assertRunnable`); a scenario cannot bypass it — an untrusted block **fails** rather
  than running.
- **New IPC ops stay session‑guarded** — keep every `scenario.*` op **out of `PUBLIC_OP_NAMES`.**
- **If/when a push event channel is added,** it must be a **fixed, validated channel** with a minimal
  preload surface (`onEvent` + unsubscribe only), mirroring the op allow‑list discipline — do **not**
  expose raw `ipcRenderer`.

---

## 10. Impact map — files to touch

Grounded in the codebase exploration; grouped by area. (Line numbers are current‑tree anchors, not
contracts.)

**Shared contract — `packages/shared/src/ops.ts`**
- `templateTypeSchema:226` → add `'scenario'`; `SUBTYPES:851` + `DEFAULT_SUBTYPE:872` → add `scenario`
  (e.g. `['json']` / `'json'`). Leave `CODE_TEMPLATE_TYPES` unchanged (a scenario graph is not user JS).
- `DATA_CAPABILITIES:799` → add `'previous'`.
- New ops (5‑slot pattern each): `scenario.run`, `scenario.stop`, `scenario.runStatus`,
  `scenario.runList`, `scenario.runClear` (+ optional `scenario.validate`). For each: request zod schema,
  `OP_NAMES` entry, `OP_REQUEST_SCHEMAS` entry, `OpContracts` entry + response DTO; **not** in
  `PUBLIC_OP_NAMES`.
- New DTOs: `ScenarioGraph`, `ScenarioNode`, `ScenarioEdge`, `BlockOutput`, `ScenarioRunDto`,
  `ScenarioRunStepDto`, run request/response types.

**Main — storage & services**
- `storage/schema.ts` → `SCENARIO_RUNS_DDL` + `SCENARIO_RUN_STEPS_DDL`; add to `LOCAL_ONLY_TABLES` and
  `SCHEMA_DDL`; migration `{ to: 25, sql: … }`; bump `SCHEMA_VERSION` to `25`. Tests:
  `storage/schema.test.ts` (local‑only columns) + `workspace/migration.test.ts` (v1→current still opens).
- `seebo/SeeboHost.ts` → extend `SeeboRenderContext`; register `previous` data capability
  (`:216-246`); ensure `dataCapabilityNames()` includes it.
- `workspace/ApiRunService.ts` → optional history sink / `scenarioRunId` so scenario steps record to the
  run, not the template (`:39`, `:87`).
- `actions/ScenarioService.ts` (**new**) → the runner (§7); `services.ts` `serviceSlot('ScenarioService')`;
  `app-bootstrap.ts` construction + `setScenarioService(...)`.
- `workspace/ScenarioRunRepo.ts` (**new**, `extends RepoBase` for reads; raw INSERTs for local‑only rows).
- `transport/handlers.ts` → `scenario.*` handlers via `svc(...)` → `getScenarioService()`.
- `workspace/TemplateService.ts` → `STARTER_SCENARIO_SOURCE` (`JSON.stringify({nodes:[],edges:[]})`) +
  branch in `starterSource()` (`:72-76`).

**Renderer**
- `document/ScenarioView.tsx` (**new**) — the canvas editor (§4): graph model in state, `JSON.stringify`
  into `source` via `template.updateSource`; run controls (start node, run, stop, delays, repeat);
  progress via polling `scenario.runStatus`; a run‑history panel + per‑step detail popup (reuse the
  Action panel's popup pattern).
- `workspace/WorkspaceView.tsx` → import `ScenarioView`; add `scenario` case to `TabIcon:46-52` and the
  view router `:343-366`.
- `workspace/WorkingTree.tsx` → `TypeIcon:56-67` case; `TypeFilterButton` options `:79-85`.
- `workspace/CreateTemplateDialog.tsx` → `TYPE_OPTIONS:10-15` entry (`tpl.scenario`/`tpl.scenarioDesc`).
- `workspace/FolderView.tsx` `TypeIcon:33-36`; `workspace/badges.ts` `rowBadge` (optional dedicated badge).
- `i18n/catalogs.ts` → `tpl.scenario` / `tpl.scenarioDesc` (+ scenario UI strings) in **both** EN
  (`:227-237`) and IT (`:704-712`).
- `ui/icons.tsx` + `ui/index.ts` → `ScenarioIcon` (flow/graph glyph) + barrel export.
- Reused as‑is: `editor/SeeboField.tsx`, `editor/CodeEditor.tsx`, `document/OutputView`‑style popups,
  the `application/swaft-template` drop protocol.

**No changes needed:** IPC router/allow‑list (derived from `OP_NAMES`), preload (unless/until the push
channel is added), `template.create`/`template.updateSource` (already carry `source`+`type`).

---

## 11. Phased delivery plan (for implementation)

Each phase is independently shippable and testable (unit + a real‑app Playwright drive, per the repo's
verification norm). Phases are ordered to de‑risk early.

### Phase 0 — Type plumbing (no behavior)
Add `scenario` to the type enum + all exhaustive maps; new `ScenarioIcon`; create dialog card; tree icon
+ filter; i18n; `STARTER_SCENARIO_SOURCE`; a stub `ScenarioView` that loads/saves the JSON graph
(text‑only placeholder) via `template.updateSource`.
**Done when:** a Scenario can be created, opens its tab, persists an (empty) graph, round‑trips on
reload; full suite green.

### Phase 1 — Editor MVP (canvas or list) + graph model
Graph data model + serialization; palette drop (`application/swaft-template`) + "＋ Add block"; nodes
(template/start/decision/delay), edges, node inspector (alias, ref, version, delay, condition via
`SeeboField`); node drag / edge draw / pan‑zoom (native SVG + pointer events). *Optionally* ship the
**list mode** first as the interim editor.
**Done when:** a user can build and persist a small graph; validation flags broken refs; e2e builds a
2‑node graph and reloads it.

### Phase 2 — `previous()` + execution engine (single run)
Extend `SeeboRenderContext`; register `previous` data capability; `ScenarioService` sequential runner
using the existing per‑step primitives; `BlockOutput` normalization; decision evaluation; `scenario.run`
returns a `runId`; local‑only `scenario_runs`/`scenario_run_steps`; poll‑based progress; run‑history
panel + per‑step detail popup. Cooperative `scenario.stop`.
**Done when:** an API→decision→action scenario runs end‑to‑end, `previous('login').status` gates the
branch, history + step details render; e2e drives a real run.

### Phase 3 — Delays, stop, in‑session batch
Inter‑step + inter‑run delays; robust cooperative cancellation; repeat‑N runs with spacing; run list +
clear.
**Done when:** a 3× repeat with a 1 s gap runs and is visible in history; Stop halts between steps.

### Phase 4 — Richness
Per‑node version pinning UX; auto‑layout heuristic; canvas polish (minimap, snapping); `AbortSignal` into
`HttpService` for mid‑flight HTTP cancel.

### Phase 5 — Durable scheduling & live push (optional)
`AppStore`‑persisted schedule jobs + a bootstrap scheduler (fires while app is open, clearly labelled);
an allow‑listed `swaft:events` push channel + preload `onEvent` for smooth live progress.

---

## 12. Testing strategy

- **Shared:** zod schema round‑trips for the new ops/DTOs; graph JSON parse/serialize.
- **Main:** `ScenarioService` runner with a fake clock and stubbed per‑step services — cover sequencing,
  decision branching, `previous()` data flow, stop‑between‑steps, `stopOnError`, `MAX_STEPS`, sandbox
  policy (prod forbidden), redaction of stored steps. Migration `to: 25` in `schema.test.ts` +
  `migration.test.ts`.
- **Renderer:** `ScenarioView` graph editing (add/connect/delete), serialization to `source`,
  poll‑driven progress rendering, run‑history + step popup.
- **E2E (Playwright, built app):** create a Scenario, build a graph by dragging templates from the tree,
  run it, observe per‑step history and a step‑detail popup — the repo's standard "drive the real app"
  verification.

---

### Appendix A — Key code anchors (verified)

- Template type enum & maps: `packages/shared/src/ops.ts:226,799,851,872,1110`.
- Tab router & per‑type view mount: `apps/desktop/src/renderer/src/workspace/WorkspaceView.tsx:39,46-52,343-366`.
- JSON‑in‑source precedent (API): `apps/desktop/src/renderer/src/document/ApiView.tsx:62-76` (parse), `save()` → `JSON.stringify` + `template.updateSource`.
- Per‑render capability wiring & context: `apps/desktop/src/main/seebo/SeeboHost.ts:79-83,203-285,216-246,293-297`.
- Data‑capability pruning: `apps/desktop/src/main/workspace/RenderService.ts:43-46`.
- Per‑step executors: `ApiRunService.ts:39`, `actions/ActionService.ts:44`, `usercode/UserCodeRegistry.ts:175`.
- Per‑template history (to relocate): `workspace/ApiHistoryService.ts`, `schema.ts:130-151,183-192`.
- No scheduler / no streaming: preload exposes only `invoke` (`preload/index.ts`); no `webContents.send`/`setInterval` in main.
- DnD protocol: `WorkingTree.tsx` (`application/swaft-template`) → `batcher/BatcherView.tsx:26-44`.
- Pointer‑drag precedent: `workspace/WorkspaceView.tsx:186-201`, `document/useDocLayout.ts:77-111`.
- Schema/migrations: `storage/schema.ts` (`SCHEMA_VERSION=24`, `MIGRATIONS`), `RepoBase.ts:17-58`.
- Op contract pattern: `packages/shared/src/ops.ts` (`OP_NAMES`, `OP_REQUEST_SCHEMAS`, `OpContracts`, `PUBLIC_OP_NAMES`), `transport/handlers.ts`, `ipc/router.ts` + `channels.ts`.
- Offline / no‑new‑dep rule: `analisi_codice_utente.md:186-188`.
