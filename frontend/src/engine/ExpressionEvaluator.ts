/**
 * Expression Evaluator for JSON-Driven UI Engine
 *
 * Handles {{expression}} syntax for dynamic values in JSON page definitions.
 * Expressions can reference: state, data, params, event, row, item, index, form
 */

import { get } from "lodash-es";
import type { ExpressionContext } from "./types";

// Pattern to match {{expressions}}
const EXPRESSION_PATTERN = /\{\{(.+?)\}\}/g;

// Pattern to detect if a string contains any expressions
const HAS_EXPRESSION_PATTERN = /\{\{.+?\}\}/;

/**
 * Check if a value contains expressions
 */
export function hasExpression(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return HAS_EXPRESSION_PATTERN.test(value);
}

/**
 * Check if a string is a pure expression (entire string is one expression)
 */
export function isPureExpression(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{{") || !trimmed.endsWith("}}")) return false;
  // Check that there's only one expression
  const matches = trimmed.match(EXPRESSION_PATTERN);
  return matches !== null && matches.length === 1 && matches[0] === trimmed;
}

/**
 * Evaluate a single expression path against the context
 * Supports: state.foo, data.entities, params.id, row.name, item.value, etc.
 * Also supports simple ternary: condition ? trueValue : falseValue
 */
function evaluatePath(path: string, context: ExpressionContext): unknown {
  const trimmedPath = path.trim();

  // Handle simple ternary expressions: condition ? trueVal : falseVal
  const ternaryMatch = trimmedPath.match(/^(.+?)\s*\?\s*(.+?)\s*:\s*(.+)$/);
  if (ternaryMatch) {
    const [, condition, trueVal, falseVal] = ternaryMatch;
    const conditionResult = evaluatePath(condition, context);
    return conditionResult
      ? evaluatePath(trueVal.trim(), context)
      : evaluatePath(falseVal.trim(), context);
  }

  // Handle simple comparison operators
  const comparisonMatch = trimmedPath.match(/^(.+?)\s*(===?|!==?|>=?|<=?)\s*(.+)$/);
  if (comparisonMatch) {
    const [, left, op, right] = comparisonMatch;
    const leftVal = evaluatePath(left.trim(), context);
    const rightVal = parseValue(right.trim(), context);

    switch (op) {
      case "==":
      case "===":
        return leftVal === rightVal;
      case "!=":
      case "!==":
        return leftVal !== rightVal;
      case ">":
        return Number(leftVal) > Number(rightVal);
      case ">=":
        return Number(leftVal) >= Number(rightVal);
      case "<":
        return Number(leftVal) < Number(rightVal);
      case "<=":
        return Number(leftVal) <= Number(rightVal);
    }
  }

  // Handle logical operators
  if (trimmedPath.includes(" && ")) {
    const parts = trimmedPath.split(" && ");
    return parts.every((part) => Boolean(evaluatePath(part.trim(), context)));
  }

  if (trimmedPath.includes(" || ")) {
    const parts = trimmedPath.split(" || ");
    // Return the first truthy value (like JavaScript's || operator)
    for (const part of parts) {
      const value = evaluatePath(part.trim(), context);
      if (value) return value;
    }
    // Return the last value if none are truthy
    return evaluatePath(parts[parts.length - 1].trim(), context);
  }

  // Handle negation
  if (trimmedPath.startsWith("!")) {
    return !evaluatePath(trimmedPath.slice(1).trim(), context);
  }

  // Handle string literals
  if (
    (trimmedPath.startsWith("'") && trimmedPath.endsWith("'")) ||
    (trimmedPath.startsWith('"') && trimmedPath.endsWith('"'))
  ) {
    return trimmedPath.slice(1, -1);
  }

  // Handle number literals
  if (/^-?\d+(\.\d+)?$/.test(trimmedPath)) {
    return Number(trimmedPath);
  }

  // Handle boolean literals
  if (trimmedPath === "true") return true;
  if (trimmedPath === "false") return false;
  if (trimmedPath === "null") return null;
  if (trimmedPath === "undefined") return undefined;

  // Standard path resolution using lodash get
  return get(context, trimmedPath);
}

/**
 * Parse a value that might be a literal or a path
 */
function parseValue(value: string, context: ExpressionContext): unknown {
  const trimmed = value.trim();

  // String literal
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }

  // Number literal
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  // Boolean/null literals
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;

  // Otherwise treat as path
  return evaluatePath(trimmed, context);
}

/**
 * Evaluate a single expression string (the content inside {{}})
 */
export function evaluateExpressionContent(content: string, context: ExpressionContext): unknown {
  return evaluatePath(content, context);
}

/**
 * Evaluate an expression that may contain {{}} placeholders
 *
 * If the entire value is a single expression like "{{state.count}}",
 * returns the raw value (preserving type).
 *
 * If the value contains embedded expressions like "Hello {{state.name}}!",
 * returns a string with expressions interpolated.
 */
export function evaluateExpression(value: unknown, context: ExpressionContext): unknown {
  // Non-string values pass through unchanged
  if (typeof value !== "string") {
    return value;
  }

  // No expressions - return as-is
  if (!hasExpression(value)) {
    return value;
  }

  // Pure expression - return the raw value (preserves type)
  if (isPureExpression(value)) {
    const content = value.slice(2, -2); // Remove {{ and }}
    return evaluateExpressionContent(content, context);
  }

  // Mixed expression - interpolate into string
  return value.replace(EXPRESSION_PATTERN, (_, content) => {
    const result = evaluateExpressionContent(content, context);
    return result === undefined || result === null ? "" : String(result);
  });
}

/**
 * Recursively resolve all expressions in an object
 */
export function resolveProps(
  props: Record<string, unknown>,
  context: ExpressionContext
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(props)) {
    resolved[key] = resolveValue(value, context);
  }

  return resolved;
}

/**
 * Resolve a single value (recursively handles objects and arrays)
 */
export function resolveValue(value: unknown, context: ExpressionContext): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return evaluateExpression(value, context);
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(item, context));
  }

  if (typeof value === "object") {
    // Check if it's an action definition (has 'action' property)
    // Actions should not have their nested values resolved immediately
    if ("action" in value) {
      return value; // Return actions as-is - they're resolved at dispatch time
    }

    return resolveProps(value as Record<string, unknown>, context);
  }

  return value;
}

/**
 * Create an expression context with defaults
 */
export function createExpressionContext(
  partial: Partial<ExpressionContext> = {}
): ExpressionContext {
  return {
    state: {},
    data: {},
    params: {},
    ...partial,
  };
}

/**
 * Merge additional context into an existing context
 */
export function mergeContext(
  base: ExpressionContext,
  additional: Partial<ExpressionContext>
): ExpressionContext {
  return {
    ...base,
    ...additional,
    // Merge nested objects properly
    state: { ...base.state, ...(additional.state || {}) },
    data: { ...base.data, ...(additional.data || {}) },
    params: { ...base.params, ...(additional.params || {}) },
  };
}
