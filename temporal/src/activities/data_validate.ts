import { log } from "@temporalio/activity";
import { collectValidationErrors } from "../workflows/dsl/validation";

/**
 * Domain-specific invoice validation rules.
 * Used as an alternative to JSON Schema when callers want a concise
 * business-rule description rather than a full schema definition.
 */
export interface InvoiceValidationRules {
  /** Field names that must be present and non-empty. */
  required_fields?: string[];
  /** When true, the field named by amount_field must be a positive number. */
  amount_positive?: boolean;
  /** Field names that must contain an ISO 8601 date string (YYYY-MM-DD) if non-null. */
  date_fields_iso?: string[];
  /** Name of the amount field (default: "amount"). */
  amount_field?: string;
  /** Name of the currency field (default: "currency"). Must be a 3-character ISO 4217 code. */
  currency_field?: string;
}

export interface DataValidateArgs {
  data: unknown;
  /** JSON Schema to validate data against. Either schema or rules must be provided. */
  schema?: Record<string, unknown>;
  /** Invoice-domain rules. Either rules or schema must be provided. */
  rules?: InvoiceValidationRules;
  coerce?: boolean;
  transform?: Record<string, string>; // outputKey -> dot-path into data
  /**
   * When true the activity throws instead of returning valid=false.
   * Defaults to true when rules is provided (fail-fast for domain validation),
   * and to false when only schema is provided (backward-compatible).
   */
  throw_on_invalid?: boolean;
  _idempotency_key: string;
}

export interface DataValidateResult {
  valid: boolean;
  errors: string[];
  transformed_data?: unknown;
  /** Populated when rules-based validation runs: the normalized invoice fields. */
  normalized?: Record<string, unknown>;
}

/**
 * Coerce a value toward the type declared in the schema.
 * Supports string→number, string→boolean, number→boolean conversions.
 * Returns the (possibly converted) value unchanged if no coercion applies.
 */
function coerceValue(value: unknown, schema: Record<string, unknown>): unknown {
  const targetType = Array.isArray(schema.type)
    ? (schema.type as string[]).find((t) => t !== "null")
    : typeof schema.type === "string"
      ? schema.type
      : undefined;

  if (targetType === "number" || targetType === "integer") {
    if (typeof value === "string") {
      const n = Number(value);
      if (!Number.isNaN(n)) return n;
    }
  }

  if (targetType === "boolean") {
    if (typeof value === "string") {
      if (value === "true") return true;
      if (value === "false") return false;
    }
    if (typeof value === "number") return value !== 0;
  }

  if (targetType === "string") {
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }

  return value;
}

/**
 * Recursively coerce all values in data whose paths appear in the schema's
 * `properties` definitions, then return the coerced copy.
 */
function coerceData(data: unknown, schema: Record<string, unknown>): unknown {
  if (data === null || data === undefined) return data;

  if (
    typeof data === "object" &&
    !Array.isArray(data) &&
    schema.properties &&
    typeof schema.properties === "object"
  ) {
    const obj = data as Record<string, unknown>;
    const props = schema.properties as Record<string, Record<string, unknown>>;
    const result: Record<string, unknown> = { ...obj };
    for (const [key, propSchema] of Object.entries(props)) {
      if (key in result) {
        result[key] = coerceData(result[key], propSchema);
      }
    }
    return result;
  }

  if (Array.isArray(data) && schema.items && typeof schema.items === "object") {
    const itemSchema = schema.items as Record<string, unknown>;
    return (data as unknown[]).map((item) => coerceData(item, itemSchema));
  }

  return coerceValue(data, schema);
}

/** JSONPath-style field extraction: supports $.x.y.z and x.y.z notation. */
function getPath(obj: unknown, path: string): unknown {
  const clean = path.startsWith("$.") ? path.slice(2) : path.startsWith("$") ? path.slice(1) : path;
  const parts = clean.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Normalize an ISO date string to YYYY-MM-DD, or return null if the value is empty or unparseable. */
function normalizeIsoDate(value: unknown): string | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const s = String(value).trim();
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Run invoice-domain rules against a plain-object payload.
 * Returns collected errors and a normalized copy of the data.
 */
function validateWithRules(
  data: unknown,
  rules: InvoiceValidationRules
): { errors: string[]; normalized: Record<string, unknown> } {
  const obj =
    data !== null && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  const errors: string[] = [];

  for (const field of rules.required_fields ?? []) {
    const v = obj[field];
    if (v === undefined || v === null || String(v).trim() === "") {
      errors.push(`Missing required field: ${field}`);
    }
  }

  const amountField = rules.amount_field ?? "amount";
  if (rules.amount_positive) {
    const rawAmount = Number(obj[amountField]);
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
      errors.push(
        `${amountField} must be a positive number, got: ${JSON.stringify(obj[amountField])}`
      );
    }
  }

  const currencyField = rules.currency_field ?? "currency";
  if (currencyField in obj) {
    const currency = String(obj[currencyField] ?? "").trim();
    if (currency.length !== 3) {
      errors.push(
        `${currencyField} must be a 3-character ISO 4217 code, got: ${JSON.stringify(obj[currencyField])}`
      );
    }
  }

  for (const field of rules.date_fields_iso ?? []) {
    const v = obj[field];
    if (v !== null && v !== undefined && String(v).trim() !== "") {
      if (normalizeIsoDate(v) === null) {
        errors.push(
          `${field} must be an ISO 8601 date string (YYYY-MM-DD), got: ${JSON.stringify(v)}`
        );
      }
    }
  }

  const normalized: Record<string, unknown> = { ...obj };
  for (const field of rules.date_fields_iso ?? []) {
    if (field in normalized) {
      normalized[field] = normalizeIsoDate(normalized[field]);
    }
  }
  if (currencyField in normalized) {
    normalized[currencyField] = String(normalized[currencyField] ?? "")
      .trim()
      .toUpperCase();
  }

  return { errors, normalized };
}

export async function data_validate(args: DataValidateArgs): Promise<DataValidateResult> {
  log.info("data_validate", {
    coerce: args.coerce ?? false,
    hasTransform: !!args.transform,
    hasRules: !!args.rules,
    hasSchema: !!args.schema,
  });

  const validationErrors: string[] = [];
  let normalized: Record<string, unknown> | undefined;

  // JSON Schema validation path
  if (args.schema) {
    const data = args.coerce ? coerceData(args.data, args.schema) : args.data;
    validationErrors.push(...collectValidationErrors(args.schema, data));
  }

  // Domain rules validation path
  if (args.rules) {
    const { errors: ruleErrors, normalized: norm } = validateWithRules(args.data, args.rules);
    validationErrors.push(...ruleErrors);
    normalized = norm;
  }

  // Default: throw when rules-only (fail-fast); keep valid=false for schema-only (backward-compatible)
  const shouldThrow = args.throw_on_invalid ?? (!!args.rules && !args.schema);
  if (shouldThrow && validationErrors.length > 0) {
    throw new Error(`data_validate: validation failed — ${validationErrors.join("; ")}`);
  }

  const result: DataValidateResult = {
    valid: validationErrors.length === 0,
    errors: validationErrors,
  };

  if (normalized !== undefined) {
    result.normalized = normalized;
  }

  if (args.transform) {
    const source = args.schema && args.coerce ? coerceData(args.data, args.schema) : args.data;
    const transformed: Record<string, unknown> = {};
    for (const [outputKey, sourcePath] of Object.entries(args.transform)) {
      transformed[outputKey] = getPath(source, sourcePath);
    }
    result.transformed_data = transformed;
  }

  return result;
}
