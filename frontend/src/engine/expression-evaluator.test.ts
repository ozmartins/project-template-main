import { describe, expect, test } from "vitest";

import {
  createExpressionContext,
  evaluateExpression,
  evaluateExpressionContent,
  hasExpression,
  isPureExpression,
  mergeContext,
  resolveProps,
  resolveValue,
} from "./ExpressionEvaluator";

describe("hasExpression", () => {
  test("returns false for non-string values", () => {
    expect(hasExpression(42)).toBe(false);
    expect(hasExpression(null)).toBe(false);
    expect(hasExpression(undefined)).toBe(false);
    expect(hasExpression({})).toBe(false);
    expect(hasExpression(true)).toBe(false);
  });

  test("returns false for strings without expressions", () => {
    expect(hasExpression("hello")).toBe(false);
    expect(hasExpression("")).toBe(false);
    expect(hasExpression("no braces here")).toBe(false);
  });

  test("returns true for strings with expressions", () => {
    expect(hasExpression("{{state.foo}}")).toBe(true);
    expect(hasExpression("Hello {{state.name}}!")).toBe(true);
  });
});

describe("isPureExpression", () => {
  test("returns true for a single full expression", () => {
    expect(isPureExpression("{{state.count}}")).toBe(true);
    expect(isPureExpression("  {{state.count}}  ")).toBe(true);
  });

  test("returns false for plain strings", () => {
    expect(isPureExpression("hello")).toBe(false);
  });

  test("returns false for mixed expression strings", () => {
    expect(isPureExpression("Hello {{state.name}}!")).toBe(false);
  });

  test("returns false for multiple expressions", () => {
    expect(isPureExpression("{{state.a}} {{state.b}}")).toBe(false);
  });
});

describe("evaluateExpression", () => {
  test("passes non-string values through unchanged", () => {
    const ctx = createExpressionContext();
    expect(evaluateExpression(42, ctx)).toBe(42);
    expect(evaluateExpression(null, ctx)).toBeNull();
    expect(evaluateExpression(true, ctx)).toBe(true);
    expect(evaluateExpression({ key: "val" }, ctx)).toEqual({ key: "val" });
  });

  test("returns plain string unchanged", () => {
    const ctx = createExpressionContext();
    expect(evaluateExpression("hello", ctx)).toBe("hello");
  });

  test("resolves state path", () => {
    const ctx = createExpressionContext({ state: { name: "Alice" } });
    expect(evaluateExpression("{{state.name}}", ctx)).toBe("Alice");
  });

  test("resolves data path", () => {
    const ctx = createExpressionContext({ data: { count: 5 } });
    expect(evaluateExpression("{{data.count}}", ctx)).toBe(5);
  });

  test("resolves params path", () => {
    const ctx = createExpressionContext({ params: { id: "abc" } });
    expect(evaluateExpression("{{params.id}}", ctx)).toBe("abc");
  });

  test("interpolates expression into a mixed string", () => {
    const ctx = createExpressionContext({ state: { name: "Bob" } });
    expect(evaluateExpression("Hello {{state.name}}!", ctx)).toBe("Hello Bob!");
  });

  test("replaces undefined/null expressions with empty string in interpolation", () => {
    const ctx = createExpressionContext({ state: {} });
    expect(evaluateExpression("Value: {{state.missing}}", ctx)).toBe("Value: ");
  });

  test("evaluates ternary expression", () => {
    const ctx = createExpressionContext({ state: { active: true } });
    expect(evaluateExpression("{{state.active ? 'yes' : 'no'}}", ctx)).toBe("yes");

    const ctxFalse = createExpressionContext({ state: { active: false } });
    expect(evaluateExpression("{{state.active ? 'yes' : 'no'}}", ctxFalse)).toBe("no");
  });

  test("evaluates === comparison", () => {
    const ctx = createExpressionContext({ state: { status: "open" } });
    expect(evaluateExpression("{{state.status === 'open'}}", ctx)).toBe(true);
    expect(evaluateExpression("{{state.status === 'closed'}}", ctx)).toBe(false);
  });

  test("evaluates !== comparison", () => {
    const ctx = createExpressionContext({ state: { status: "open" } });
    expect(evaluateExpression("{{state.status !== 'closed'}}", ctx)).toBe(true);
  });

  test("evaluates numeric comparisons", () => {
    const ctx = createExpressionContext({ state: { count: 5 } });
    expect(evaluateExpression("{{state.count > 3}}", ctx)).toBe(true);
    expect(evaluateExpression("{{state.count < 3}}", ctx)).toBe(false);
    expect(evaluateExpression("{{state.count >= 5}}", ctx)).toBe(true);
    expect(evaluateExpression("{{state.count <= 5}}", ctx)).toBe(true);
  });

  test("evaluates && logical operator", () => {
    const ctx = createExpressionContext({ state: { a: true, b: true } });
    expect(evaluateExpression("{{state.a && state.b}}", ctx)).toBe(true);

    const ctxFalse = createExpressionContext({ state: { a: true, b: false } });
    expect(evaluateExpression("{{state.a && state.b}}", ctxFalse)).toBe(false);
  });

  test("evaluates || logical operator", () => {
    const ctx = createExpressionContext({ state: { a: false, b: "fallback" } });
    expect(evaluateExpression("{{state.a || state.b}}", ctx)).toBe("fallback");
  });

  test("evaluates ! negation", () => {
    const ctx = createExpressionContext({ state: { active: false } });
    expect(evaluateExpression("{{!state.active}}", ctx)).toBe(true);
  });

  test("evaluates string literals inside expressions", () => {
    const ctx = createExpressionContext();
    expect(evaluateExpression("{{'hello'}}", ctx)).toBe("hello");
    expect(evaluateExpression('{{"world"}}', ctx)).toBe("world");
  });

  test("evaluates numeric literals inside expressions", () => {
    const ctx = createExpressionContext();
    expect(evaluateExpression("{{42}}", ctx)).toBe(42);
    expect(evaluateExpression("{{-1}}", ctx)).toBe(-1);
  });

  test("evaluates boolean and null literals", () => {
    const ctx = createExpressionContext();
    expect(evaluateExpression("{{true}}", ctx)).toBe(true);
    expect(evaluateExpression("{{false}}", ctx)).toBe(false);
    expect(evaluateExpression("{{null}}", ctx)).toBeNull();
    expect(evaluateExpression("{{undefined}}", ctx)).toBeUndefined();
  });
});

describe("evaluateExpressionContent", () => {
  test("evaluates a path directly", () => {
    const ctx = createExpressionContext({ state: { x: 99 } });
    expect(evaluateExpressionContent("state.x", ctx)).toBe(99);
  });
});

describe("resolveValue", () => {
  test("passes null and undefined through", () => {
    const ctx = createExpressionContext();
    expect(resolveValue(null, ctx)).toBeNull();
    expect(resolveValue(undefined, ctx)).toBeUndefined();
  });

  test("resolves expression in string value", () => {
    const ctx = createExpressionContext({ state: { label: "click me" } });
    expect(resolveValue("{{state.label}}", ctx)).toBe("click me");
  });

  test("returns non-expression string as-is", () => {
    const ctx = createExpressionContext();
    expect(resolveValue("static text", ctx)).toBe("static text");
  });

  test("recursively resolves arrays", () => {
    const ctx = createExpressionContext({ state: { val: "item" } });
    expect(resolveValue(["{{state.val}}", "literal"], ctx)).toEqual(["item", "literal"]);
  });

  test("returns action objects as-is without resolving", () => {
    const ctx = createExpressionContext({ state: { target: "/dashboard" } });
    const action = { action: "navigate", to: "{{state.target}}" };
    expect(resolveValue(action, ctx)).toBe(action);
  });

  test("recursively resolves plain objects", () => {
    const ctx = createExpressionContext({ state: { title: "Hello" } });
    const obj = { label: "{{state.title}}", count: 5 };
    expect(resolveValue(obj, ctx)).toEqual({ label: "Hello", count: 5 });
  });

  test("passes through number and boolean values", () => {
    const ctx = createExpressionContext();
    expect(resolveValue(42, ctx)).toBe(42);
    expect(resolveValue(true, ctx)).toBe(true);
  });
});

describe("resolveProps", () => {
  test("resolves all prop values in an object", () => {
    const ctx = createExpressionContext({ state: { name: "World" } });
    const result = resolveProps({ greeting: "Hello {{state.name}}", count: 3 }, ctx);
    expect(result).toEqual({ greeting: "Hello World", count: 3 });
  });
});

describe("createExpressionContext", () => {
  test("creates context with empty defaults", () => {
    const ctx = createExpressionContext();
    expect(ctx.state).toEqual({});
    expect(ctx.data).toEqual({});
    expect(ctx.params).toEqual({});
  });

  test("merges provided partial values", () => {
    const ctx = createExpressionContext({ state: { key: "value" }, params: { id: "1" } });
    expect(ctx.state).toEqual({ key: "value" });
    expect(ctx.params).toEqual({ id: "1" });
    expect(ctx.data).toEqual({});
  });
});

describe("mergeContext", () => {
  test("merges nested state, data, and params", () => {
    const base = createExpressionContext({
      state: { a: 1 },
      data: { items: [] },
      params: { id: "x" },
    });
    const result = mergeContext(base, { state: { b: 2 }, params: { page: "1" } });
    expect(result.state).toEqual({ a: 1, b: 2 });
    expect(result.data).toEqual({ items: [] });
    expect(result.params).toEqual({ id: "x", page: "1" });
  });

  test("later values override base values", () => {
    const base = createExpressionContext({ state: { val: "old" } });
    const result = mergeContext(base, { state: { val: "new" } });
    expect(result.state.val).toBe("new");
  });
});
