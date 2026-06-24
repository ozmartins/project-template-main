import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { Text } from "../components/engine/typography/Text";
import entityDetailPage from "../pages/entity-detail.json";
import { createExpressionContext, evaluateExpression } from "./ExpressionEvaluator";

function findRevisionTernaryExpression(node: unknown): string | undefined {
  if (Array.isArray(node)) {
    for (const item of node) {
      const expression = findRevisionTernaryExpression(item);
      if (expression) return expression;
    }
    return undefined;
  }

  if (!node || typeof node !== "object") {
    return undefined;
  }

  const record = node as Record<string, unknown>;
  const props = record.props;

  if (props && typeof props === "object") {
    const children = (props as Record<string, unknown>).children;
    if (
      typeof children === "string" &&
      children.includes("Current revision") &&
      children.includes("Previous revision")
    ) {
      return children;
    }
  }

  for (const value of Object.values(record)) {
    const expression = findRevisionTernaryExpression(value);
    if (expression) return expression;
  }

  return undefined;
}

test('Text with format="datetime" renders readable date output', () => {
  const isoTimestamp = "2026-05-12T13:45:00.000Z";
  const html = renderToStaticMarkup(<Text format="datetime">{isoTimestamp}</Text>);

  expect(html.includes(isoTimestamp)).toBe(false);
  expect(html.includes("T")).toBe(false);
  expect(html.includes("Z")).toBe(false);
  expect(html).toMatch(/2026/);
  expect(html).toMatch(/[A-Za-z]{3,}|\d{1,2}\/\d{1,2}/);
  expect(html).toMatch(/:/);
});

test("entity-detail revision ternary resolves current/previous labels", () => {
  const expression = findRevisionTernaryExpression(entityDetailPage);

  expect(expression).toBe("{{version.is_current ? 'Current revision' : 'Previous revision'}}");
  expect(
    evaluateExpression(expression, createExpressionContext({ version: { is_current: true } }))
  ).toBe("Current revision");
  expect(
    evaluateExpression(expression, createExpressionContext({ version: { is_current: false } }))
  ).toBe("Previous revision");
});
