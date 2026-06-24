/**
 * Minimal JSON Schema validator for DSL activity I/O contracts.
 *
 * Runs inside Temporal's V8 workflow isolate — no external dependencies,
 * no eval(). Handles the subset of JSON Schema needed for activity contracts:
 * type, required, properties, additionalProperties, enum, const,
 * minimum/maximum, minLength/maxLength, items (array), nullable (oneOf null).
 *
 * Throws a ValidationError with a path-qualified message on mismatch.
 * Callers catch this to trigger a Temporal activity retry.
 */

export class ValidationError extends Error {
  constructor(
    public readonly path: string,
    message: string
  ) {
    super(`Schema validation failed at ${path}: ${message}`);
    this.name = "ValidationError";
  }
}

type Schema = Record<string, unknown>;

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** Returns the allowed types from a schema, handling both string and array forms. */
function allowedTypes(schema: Schema): string[] | null {
  if (!("type" in schema)) return null;
  const t = schema.type;
  if (Array.isArray(t)) return t as string[];
  if (typeof t === "string") return [t];
  return null;
}

export function validateSchema(schema: Schema, value: unknown, path = "$"): void {
  // Nullable shorthand: { type: ['string', 'null'] } or { nullable: true }
  const types = allowedTypes(schema);
  if (types) {
    const actual = typeOf(value);
    const allowed = schema.nullable ? [...types, "null"] : types;
    if (!allowed.includes(actual)) {
      throw new ValidationError(path, `expected type ${allowed.join("|")}, got ${actual}`);
    }
    if (value === null) return; // null passes nullable check
  }

  // enum
  if ("enum" in schema) {
    const enumVals = schema.enum as unknown[];
    if (!enumVals.some((e) => e === value)) {
      throw new ValidationError(
        path,
        `value ${JSON.stringify(value)} not in enum ${JSON.stringify(enumVals)}`
      );
    }
  }

  // const
  if ("const" in schema && value !== schema.const) {
    throw new ValidationError(
      path,
      `expected ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`
    );
  }

  // Number constraints
  if (typeof value === "number") {
    if ("minimum" in schema && value < (schema.minimum as number)) {
      throw new ValidationError(path, `${value} < minimum ${schema.minimum}`);
    }
    if ("maximum" in schema && value > (schema.maximum as number)) {
      throw new ValidationError(path, `${value} > maximum ${schema.maximum}`);
    }
    if ("exclusiveMinimum" in schema && value <= (schema.exclusiveMinimum as number)) {
      throw new ValidationError(path, `${value} <= exclusiveMinimum ${schema.exclusiveMinimum}`);
    }
    if ("exclusiveMaximum" in schema && value >= (schema.exclusiveMaximum as number)) {
      throw new ValidationError(path, `${value} >= exclusiveMaximum ${schema.exclusiveMaximum}`);
    }
  }

  // String constraints
  if (typeof value === "string") {
    if ("minLength" in schema && value.length < (schema.minLength as number)) {
      throw new ValidationError(
        path,
        `string length ${value.length} < minLength ${schema.minLength}`
      );
    }
    if ("maxLength" in schema && value.length > (schema.maxLength as number)) {
      throw new ValidationError(
        path,
        `string length ${value.length} > maxLength ${schema.maxLength}`
      );
    }
    if ("pattern" in schema) {
      const re = new RegExp(schema.pattern as string);
      if (!re.test(value)) {
        throw new ValidationError(path, `string does not match pattern ${schema.pattern}`);
      }
    }
  }

  // Array
  if (Array.isArray(value)) {
    if ("minItems" in schema && value.length < (schema.minItems as number)) {
      throw new ValidationError(path, `array length ${value.length} < minItems ${schema.minItems}`);
    }
    if ("maxItems" in schema && value.length > (schema.maxItems as number)) {
      throw new ValidationError(path, `array length ${value.length} > maxItems ${schema.maxItems}`);
    }
    if ("items" in schema && schema.items) {
      const itemSchema = schema.items as Schema;
      for (let i = 0; i < value.length; i++) {
        validateSchema(itemSchema, value[i], `${path}[${i}]`);
      }
    }
  }

  // Object
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;

    // required
    if ("required" in schema && Array.isArray(schema.required)) {
      for (const key of schema.required as string[]) {
        if (!(key in obj)) {
          throw new ValidationError(`${path}.${key}`, `required field missing`);
        }
      }
    }

    // properties
    if ("properties" in schema && schema.properties) {
      const props = schema.properties as Record<string, Schema>;
      for (const [key, propSchema] of Object.entries(props)) {
        if (key in obj) {
          validateSchema(propSchema, obj[key], `${path}.${key}`);
        }
      }
    }

    // additionalProperties: false
    if (schema.additionalProperties === false && "properties" in schema) {
      const allowed = new Set(Object.keys(schema.properties as object));
      for (const key of Object.keys(obj)) {
        if (!allowed.has(key)) {
          throw new ValidationError(`${path}.${key}`, `additionalProperties not allowed`);
        }
      }
    }
  }

  // oneOf / anyOf (minimal: treat as "any must validate")
  if ("anyOf" in schema && Array.isArray(schema.anyOf)) {
    const schemas = schema.anyOf as Schema[];
    const errors: string[] = [];
    for (const s of schemas) {
      try {
        validateSchema(s, value, path);
        return;
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    throw new ValidationError(path, `no anyOf schema matched: [${errors.join(" | ")}]`);
  }

  if ("oneOf" in schema && Array.isArray(schema.oneOf)) {
    const schemas = schema.oneOf as Schema[];
    let matchCount = 0;
    for (const s of schemas) {
      try {
        validateSchema(s, value, path);
        matchCount++;
      } catch {
        /* ok */
      }
    }
    if (matchCount !== 1) {
      throw new ValidationError(path, `oneOf: expected exactly 1 match, got ${matchCount}`);
    }
  }
}

/**
 * Collects all JSON Schema validation errors for `value` against `schema`,
 * returning them as an array of formatted messages (empty array when valid).
 *
 * Unlike `validateSchema`, this function never throws and continues traversal
 * after encountering an error so that every violation is reported in a single
 * call — suitable for user-facing error aggregation in `data_validate`.
 */
export function collectValidationErrors(schema: Schema, value: unknown, path = "$"): string[] {
  const errors: string[] = [];

  // Type check — if the top-level type is wrong, further structural checks are
  // meaningless (we cannot safely inspect properties of the wrong type).
  const types = allowedTypes(schema);
  if (types) {
    const actual = typeOf(value);
    const allowed = schema.nullable ? [...types, "null"] : types;
    if (!allowed.includes(actual)) {
      errors.push(
        `Schema validation failed at ${path}: expected type ${allowed.join("|")}, got ${actual}`
      );
      return errors;
    }
    if (value === null) return errors;
  }

  // enum
  if ("enum" in schema) {
    const enumVals = schema.enum as unknown[];
    if (!enumVals.some((e) => e === value)) {
      errors.push(
        `Schema validation failed at ${path}: value ${JSON.stringify(value)} not in enum ${JSON.stringify(enumVals)}`
      );
    }
  }

  // const
  if ("const" in schema && value !== schema.const) {
    errors.push(
      `Schema validation failed at ${path}: expected ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`
    );
  }

  // Number constraints
  if (typeof value === "number") {
    if ("minimum" in schema && value < (schema.minimum as number)) {
      errors.push(`Schema validation failed at ${path}: ${value} < minimum ${schema.minimum}`);
    }
    if ("maximum" in schema && value > (schema.maximum as number)) {
      errors.push(`Schema validation failed at ${path}: ${value} > maximum ${schema.maximum}`);
    }
    if ("exclusiveMinimum" in schema && value <= (schema.exclusiveMinimum as number)) {
      errors.push(
        `Schema validation failed at ${path}: ${value} <= exclusiveMinimum ${schema.exclusiveMinimum}`
      );
    }
    if ("exclusiveMaximum" in schema && value >= (schema.exclusiveMaximum as number)) {
      errors.push(
        `Schema validation failed at ${path}: ${value} >= exclusiveMaximum ${schema.exclusiveMaximum}`
      );
    }
  }

  // String constraints
  if (typeof value === "string") {
    if ("minLength" in schema && value.length < (schema.minLength as number)) {
      errors.push(
        `Schema validation failed at ${path}: string length ${value.length} < minLength ${schema.minLength}`
      );
    }
    if ("maxLength" in schema && value.length > (schema.maxLength as number)) {
      errors.push(
        `Schema validation failed at ${path}: string length ${value.length} > maxLength ${schema.maxLength}`
      );
    }
    if ("pattern" in schema) {
      const re = new RegExp(schema.pattern as string);
      if (!re.test(value)) {
        errors.push(
          `Schema validation failed at ${path}: string does not match pattern ${schema.pattern}`
        );
      }
    }
  }

  // Array
  if (Array.isArray(value)) {
    if ("minItems" in schema && value.length < (schema.minItems as number)) {
      errors.push(
        `Schema validation failed at ${path}: array length ${value.length} < minItems ${schema.minItems}`
      );
    }
    if ("maxItems" in schema && value.length > (schema.maxItems as number)) {
      errors.push(
        `Schema validation failed at ${path}: array length ${value.length} > maxItems ${schema.maxItems}`
      );
    }
    if ("items" in schema && schema.items) {
      const itemSchema = schema.items as Schema;
      for (let i = 0; i < value.length; i++) {
        errors.push(...collectValidationErrors(itemSchema, value[i], `${path}[${i}]`));
      }
    }
  }

  // Object
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;

    // required — collect ALL missing fields before moving on
    if ("required" in schema && Array.isArray(schema.required)) {
      for (const key of schema.required as string[]) {
        if (!(key in obj)) {
          errors.push(`Schema validation failed at ${path}.${key}: required field missing`);
        }
      }
    }

    // properties — recurse and accumulate
    if ("properties" in schema && schema.properties) {
      const props = schema.properties as Record<string, Schema>;
      for (const [key, propSchema] of Object.entries(props)) {
        if (key in obj) {
          errors.push(...collectValidationErrors(propSchema, obj[key], `${path}.${key}`));
        }
      }
    }

    // additionalProperties: false
    if (schema.additionalProperties === false && "properties" in schema) {
      const allowed = new Set(Object.keys(schema.properties as object));
      for (const key of Object.keys(obj)) {
        if (!allowed.has(key)) {
          errors.push(
            `Schema validation failed at ${path}.${key}: additionalProperties not allowed`
          );
        }
      }
    }
  }

  // anyOf
  if ("anyOf" in schema && Array.isArray(schema.anyOf)) {
    const schemas = schema.anyOf as Schema[];
    const branchErrors: string[] = [];
    let matched = false;
    for (const s of schemas) {
      const subErrors = collectValidationErrors(s, value, path);
      if (subErrors.length === 0) {
        matched = true;
        break;
      }
      branchErrors.push(subErrors.join("; "));
    }
    if (!matched) {
      errors.push(
        `Schema validation failed at ${path}: no anyOf schema matched: [${branchErrors.join(" | ")}]`
      );
    }
  }

  // oneOf
  if ("oneOf" in schema && Array.isArray(schema.oneOf)) {
    const schemas = schema.oneOf as Schema[];
    let matchCount = 0;
    for (const s of schemas) {
      if (collectValidationErrors(s, value, path).length === 0) matchCount++;
    }
    if (matchCount !== 1) {
      errors.push(
        `Schema validation failed at ${path}: oneOf: expected exactly 1 match, got ${matchCount}`
      );
    }
  }

  return errors;
}
