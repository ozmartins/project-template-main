/**
 * Expression evaluator for the DSL.
 *
 * Supports sigil-prefixed references:
 *   $input.<path>   — workflow input fields (dot-separated)
 *   $result.<name>  — named activity/step results
 *   $var.<name>     — any variable in the binding context
 *   $env.<key>      — top-level definition variables
 *
 * Condition expressions (used in condition.if) support:
 *   ==, !=, <, >, <=, >= comparisons
 *   in [...]  membership
 *   and / or logical operators
 *   null / true / false literals
 *
 * There is no eval() or new Function() — all evaluation is done by this
 * explicit AST-style parser. V8-isolate-safe.
 */

export type Variables = Record<string, unknown>;

function getPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function resolveSigil(expr: string, vars: Variables, input: Variables): unknown {
  if (expr.startsWith("$input.")) return getPath(input, expr.slice(7));
  if (expr.startsWith("$result.")) return getPath(vars, expr.slice(8));
  if (expr.startsWith("$var.")) return getPath(vars, expr.slice(5));
  if (expr.startsWith("$env.")) return getPath(vars, expr.slice(5));
  return undefined;
}

function isSigil(s: string): boolean {
  return (
    s.startsWith("$input.") ||
    s.startsWith("$result.") ||
    s.startsWith("$var.") ||
    s.startsWith("$env.")
  );
}

const SIGIL_PATTERN = /\$(?:input|result|var|env)\.[a-zA-Z0-9_.]+/g;

/**
 * Interpolate sigil references embedded inside a string template.
 * Non-string resolved values are JSON.stringified.
 * Example: "Company: $input.name ($input.website)" → "Company: Acme (acme.com)"
 */
export function interpolateTemplate(s: string, vars: Variables, input: Variables): string {
  return s.replace(SIGIL_PATTERN, (match) => {
    const resolved = resolveSigil(match, vars, input);
    if (resolved === undefined || resolved === null) return "";
    if (typeof resolved === "string") return resolved;
    return JSON.stringify(resolved, null, 2);
  });
}

/** Resolve a single expression value. Non-sigil strings are returned as-is. */
export function resolveExpression(expr: unknown, vars: Variables, input: Variables): unknown {
  if (typeof expr !== "string") return expr;
  // Entire value is a sigil — return the resolved value (preserves type)
  if (isSigil(expr)) return resolveSigil(expr, vars, input);
  // String containing embedded sigils — interpolate and return a string
  if (SIGIL_PATTERN.test(expr)) {
    SIGIL_PATTERN.lastIndex = 0; // reset stateful regex after .test()
    return interpolateTemplate(expr, vars, input);
  }
  return expr;
}

/** Resolve an entire args object, recursively resolving sigils in values. */
export function resolveArgs(
  args: Record<string, unknown>,
  vars: Variables,
  input: Variables
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      result[k] = resolveArgs(v as Record<string, unknown>, vars, input);
    } else if (Array.isArray(v)) {
      result[k] = v.map((item) => resolveExpression(item, vars, input));
    } else {
      result[k] = resolveExpression(v, vars, input);
    }
  }
  return result;
}

// ── Condition expression parser ────────────────────────────────────────────

function parseLiteral(token: string): unknown {
  if (token === "true") return true;
  if (token === "false") return false;
  if (token === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
  // quoted string
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    return token.slice(1, -1);
  }
  return token;
}

function resolveToken(token: string, vars: Variables, input: Variables): unknown {
  const trimmed = token.trim();
  if (isSigil(trimmed)) return resolveSigil(trimmed, vars, input);
  return parseLiteral(trimmed);
}

/**
 * Evaluate a DSL condition expression string to a boolean.
 *
 * Supported forms:
 *   <lhs> == <rhs>
 *   <lhs> != <rhs>
 *   <lhs> < | > | <= | >= <rhs>
 *   <lhs> in [a, b, c]
 *   <expr> and <expr>
 *   <expr> or <expr>
 */
export function evaluateCondition(expr: string, vars: Variables, input: Variables): boolean {
  const trimmed = expr.trim();

  // Split on ' or ' and ' and ' (lowest precedence first)
  // We handle left-to-right associativity for same-precedence operators.
  const orParts = splitOn(trimmed, " or ");
  if (orParts.length > 1) {
    return orParts.some((part) => evaluateCondition(part, vars, input));
  }

  const andParts = splitOn(trimmed, " and ");
  if (andParts.length > 1) {
    return andParts.every((part) => evaluateCondition(part, vars, input));
  }

  // in operator: lhs in [x, y, z]
  const inMatch = trimmed.match(/^(.+?)\s+in\s+\[(.+)\]$/);
  if (inMatch) {
    const lhs = resolveToken(inMatch[1].trim(), vars, input);
    const items = inMatch[2].split(",").map((s) => resolveToken(s.trim(), vars, input));
    return items.includes(lhs);
  }

  // Comparison operators (longest first to avoid partial matches)
  for (const op of ["!=", "==", "<=", ">=", "<", ">"]) {
    const idx = trimmed.indexOf(op);
    if (idx === -1) continue;
    // Make sure we're not inside a string literal (basic guard)
    const lhsStr = trimmed.slice(0, idx).trim();
    const rhsStr = trimmed.slice(idx + op.length).trim();
    if (!lhsStr || !rhsStr) continue;

    const lhs = resolveToken(lhsStr, vars, input);
    const rhs = resolveToken(rhsStr, vars, input);

    switch (op) {
      case "==":
        // biome-ignore lint/suspicious/noDoubleEquals: intentional loose equality for DSL null/undefined checks
        return lhs == rhs;
      case "!=":
        // biome-ignore lint/suspicious/noDoubleEquals: intentional loose equality for DSL null/undefined checks
        return lhs != rhs;
      case "<":
        return (lhs as number) < (rhs as number);
      case ">":
        return (lhs as number) > (rhs as number);
      case "<=":
        return (lhs as number) <= (rhs as number);
      case ">=":
        return (lhs as number) >= (rhs as number);
    }
  }

  // Bare boolean reference: $var.flag
  const val = resolveToken(trimmed, vars, input);
  return Boolean(val);
}

/** Split a string on a separator only when not inside brackets/quotes. */
function splitOn(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i <= s.length - sep.length; i++) {
    const ch = s[i];
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth--;
    else if (depth === 0 && s.slice(i, i + sep.length) === sep) {
      parts.push(s.slice(last, i));
      i += sep.length - 1;
      last = i + 1;
    }
  }
  parts.push(s.slice(last));
  return parts;
}
