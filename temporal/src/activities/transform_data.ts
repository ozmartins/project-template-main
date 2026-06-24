import { log } from "@temporalio/activity";

export interface TransformDataArgs {
  input: unknown;
  mapping: Record<string, string>; // outputKey -> dot-path into input
  _idempotency_key?: string;
}

function getPath(obj: unknown, path: string): unknown {
  // Supports $.x.y.z and x.y.z notation
  const clean = path.startsWith("$.") ? path.slice(2) : path.startsWith("$") ? path.slice(1) : path;
  const parts = clean.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export async function transform_data(args: TransformDataArgs): Promise<Record<string, unknown>> {
  log.info("transform_data", { keys: Object.keys(args.mapping) });
  const result: Record<string, unknown> = {};
  for (const [outputKey, sourcePath] of Object.entries(args.mapping)) {
    result[outputKey] = getPath(args.input, sourcePath);
  }
  return result;
}
