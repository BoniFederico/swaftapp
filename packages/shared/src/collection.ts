import type { HttpRequestModel } from './ops';

/**
 * Neutral, format-independent interchange model for importing/exporting groups of API requests
 * (open-standards plan §6). Every adapter — OpenAPI, Postman, Bruno — converts its format to/from
 * this shape, and Swaft materializes it into projects/folders/`api` templates. Keeping one neutral
 * model means the projection/creation logic is written once, not per foreign format.
 *
 * Seebo `${ … }` formulas are carried verbatim inside the request fields (plan A3). Environment
 * values are plain config (never secrets — those become `${ secret('NAME') }` references).
 */

/** One request to create, with the nested folder path it should live under (root = empty array). */
export interface ImportedRequest {
  name: string;
  /** Nested folder names from the collection root, e.g. `['Pets', 'Admin']`. */
  folderPath: string[];
  request: HttpRequestModel;
  /** Optional human description (maps to a request's `info`). */
  description?: string;
  /** The originating Swaft template id, round-tripped through a Bruno `meta.swaftId` (open-standards
   *  §3.7) so re-importing a previously-exported collection updates that template in place instead of
   *  creating a duplicate. Postman/`.http` have no slot for it and never set it. */
  swaftId?: string;
}

/** A named set of plain (non-secret) variables — maps to a Swaft environment / a dotenv file. */
export interface ImportedEnvironment {
  name: string;
  vars: Record<string, string>;
}

/** The result of importing a foreign collection/description: a flat request list + suggested envs. */
export interface ImportedCollection {
  /** Collection title (used to name a new project/folder on import). */
  name: string;
  requests: ImportedRequest[];
  environments: ImportedEnvironment[];
}
