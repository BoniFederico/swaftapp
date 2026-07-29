declare module 'js-yaml' {
  export interface DumpOptions {
    indent?: number;
    lineWidth?: number;
    noRefs?: boolean;
    sortKeys?: boolean | ((a: string, b: string) => number);
  }
  /** Parse a single YAML document to a JS value. */
  export function load(input: string): unknown;
  /** Serialize a JS value to YAML. */
  export function dump(obj: unknown, options?: DumpOptions): string;
}
