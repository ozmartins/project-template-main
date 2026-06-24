import { evaluateCondition, resolveArgs, resolveExpression } from "../src/workflows/dsl/expression";

const vars = { status: "approved", score: 720, items: ["a", "b"], nested: { x: 42 } };
const input = { customer: { email: "alice@example.com" }, amount: 100 };

describe("resolveExpression", () => {
  it("returns non-sigil strings as-is", () =>
    expect(resolveExpression("hello", vars, input)).toBe("hello"));
  it("resolves $input.customer.email", () =>
    expect(resolveExpression("$input.customer.email", vars, input)).toBe("alice@example.com"));
  it("resolves $var.status", () =>
    expect(resolveExpression("$var.status", vars, input)).toBe("approved"));
  it("resolves $result.score", () =>
    expect(resolveExpression("$result.score", vars, input)).toBe(720));
  it("resolves nested $var.nested.x", () =>
    expect(resolveExpression("$var.nested.x", vars, input)).toBe(42));
  it("returns undefined for missing path", () =>
    expect(resolveExpression("$var.missing", vars, input)).toBeUndefined());
  it("passes through numbers", () => expect(resolveExpression(42, vars, input)).toBe(42));
  it("passes through null", () => expect(resolveExpression(null, vars, input)).toBe(null));
});

describe("resolveArgs", () => {
  it("resolves nested args object", () => {
    const result = resolveArgs(
      { email: "$input.customer.email", amount: "$input.amount", static: "value" },
      vars,
      input
    );
    expect(result).toEqual({ email: "alice@example.com", amount: 100, static: "value" });
  });

  it("resolves array elements", () => {
    const result = resolveArgs({ ids: ["$input.amount", "fixed"] }, vars, input);
    expect(result).toEqual({ ids: [100, "fixed"] });
  });

  it("resolves deeply nested object", () => {
    const result = resolveArgs({ outer: { inner: "$var.status" } }, vars, input);
    expect(result).toEqual({ outer: { inner: "approved" } });
  });
});

describe("evaluateCondition", () => {
  it("evaluates == true", () =>
    expect(evaluateCondition('$var.status == "approved"', vars, input)).toBe(true));
  it("evaluates == false", () =>
    expect(evaluateCondition('$var.status == "rejected"', vars, input)).toBe(false));
  it("evaluates != ", () =>
    expect(evaluateCondition('$var.status != "rejected"', vars, input)).toBe(true));
  it("evaluates > numeric", () =>
    expect(evaluateCondition("$var.score > 700", vars, input)).toBe(true));
  it("evaluates < numeric", () =>
    expect(evaluateCondition("$var.score < 700", vars, input)).toBe(false));
  it("evaluates >= numeric", () =>
    expect(evaluateCondition("$var.score >= 720", vars, input)).toBe(true));
  it("evaluates <= numeric", () =>
    expect(evaluateCondition("$var.score <= 720", vars, input)).toBe(true));
  it("evaluates in list", () =>
    expect(evaluateCondition('$var.status in ["approved", "escalated"]', vars, input)).toBe(true));
  it("evaluates not in", () =>
    expect(evaluateCondition('$var.status in ["rejected"]', vars, input)).toBe(false));
  it("evaluates and", () =>
    expect(evaluateCondition('$var.status == "approved" and $var.score > 700', vars, input)).toBe(
      true
    ));
  it("evaluates or", () =>
    expect(evaluateCondition('$var.status == "rejected" or $var.score > 700', vars, input)).toBe(
      true
    ));
  it("evaluates true literal", () => expect(evaluateCondition("true", vars, input)).toBe(true));
  it("evaluates false literal", () => expect(evaluateCondition("false", vars, input)).toBe(false));
  it("null comparison", () =>
    expect(evaluateCondition("$var.missing == null", vars, input)).toBe(true));
});
