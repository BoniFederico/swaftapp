import { z } from 'zod';
import { templateTypeSchema } from './ops';

/**
 * Scenario graph model — the JSON stored in a `scenario` template's `source` (see docs `scenarios.md`).
 * A scenario is a normal template whose source is an editable JSON directed graph: `template` blocks
 * (wrapping an API / action / capability template), `decision` diamonds (branch on a boolean Seebo
 * formula), `delay` waits, and a `start` entry, wired by `edges`. Seebo `${ … }` formulas live inside
 * the JSON as string fields (a decision's `condition`, a block's `inputs` bindings) — exactly like an
 * `api` template stores formulas in its request. Parsing is defensive (never throws) so a half-typed,
 * hand-edited source degrades gracefully instead of crashing the canvas.
 */

export const SCENARIO_NODE_KINDS = ['start', 'template', 'decision', 'delay'] as const;
export type ScenarioNodeKind = (typeof SCENARIO_NODE_KINDS)[number];

export const scenarioPositionSchema = z.object({ x: z.number(), y: z.number() }).strict();

export const scenarioNodeSchema = z
  .object({
    id: z.string().min(1).max(64),
    kind: z.enum(SCENARIO_NODE_KINDS),
    position: scenarioPositionSchema,
    /** Optional display label (falls back to the referenced template name / kind). */
    label: z.string().max(200).optional(),

    // `template` nodes:
    /** Referenced template id (an api/action/capability template). */
    ref: z.string().min(1).optional(),
    /** Cached type of the referenced template, for the node glyph + execution dispatch. */
    templateType: templateTypeSchema.optional(),
    /** Stable name this block's output is addressed by from `previous('alias')`. */
    alias: z.string().max(120).optional(),
    /** Which version of the referenced template runs: `draft` or a release id. */
    version: z.string().max(64).optional(),
    /** Per-node input overrides (values or `${ … }` formulas) layered over the template's saved inputs. */
    inputs: z.record(z.unknown()).optional(),

    // `decision` nodes:
    /** A Seebo formula that must evaluate to a boolean; chooses the true/false outgoing edge. */
    condition: z.string().max(4096).optional(),

    // `delay` nodes:
    /** Wait this many milliseconds before continuing (0…1h). */
    ms: z.number().int().min(0).max(3_600_000).optional(),
  })
  .strict();

export const scenarioBranchSchema = z.enum(['true', 'false']);

export const scenarioEdgeSchema = z
  .object({
    id: z.string().min(1).max(64),
    from: z.string().min(1).max(64),
    to: z.string().min(1).max(64),
    /** Set on edges leaving a `decision` node (which branch they represent); null/absent otherwise. */
    branch: scenarioBranchSchema.nullable().optional(),
  })
  .strict();

export const scenarioGraphSchema = z
  .object({
    version: z.literal(1),
    nodes: z.array(scenarioNodeSchema).max(1000),
    edges: z.array(scenarioEdgeSchema).max(2000),
  })
  .strict();

export type ScenarioNode = z.infer<typeof scenarioNodeSchema>;
export type ScenarioEdge = z.infer<typeof scenarioEdgeSchema>;
export type ScenarioGraph = z.infer<typeof scenarioGraphSchema>;
export type ScenarioBranch = z.infer<typeof scenarioBranchSchema>;

export const EMPTY_SCENARIO_GRAPH: ScenarioGraph = { version: 1, nodes: [], edges: [] };

/**
 * Defensive parse of a scenario `source`. NEVER throws: on invalid JSON or a schema mismatch it
 * returns `{ ok: false, graph: EMPTY_SCENARIO_GRAPH }` so callers can keep the last-good graph and
 * surface a diagnostic rather than clobbering a source the user is mid-editing (parity with the API
 * view's `parseRequest`).
 */
export function parseScenarioGraph(source: string): { graph: ScenarioGraph; ok: boolean } {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return { graph: EMPTY_SCENARIO_GRAPH, ok: false };
  }
  const res = scenarioGraphSchema.safeParse(raw);
  return res.success ? { graph: res.data, ok: true } : { graph: EMPTY_SCENARIO_GRAPH, ok: false };
}

/** Serialize a graph back into a template `source` (pretty-printed, so hand-editing/diffs stay clean). */
export function serializeScenarioGraph(graph: ScenarioGraph): string {
  return JSON.stringify(graph, null, 2);
}
