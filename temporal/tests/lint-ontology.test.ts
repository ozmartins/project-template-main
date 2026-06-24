import { resolve } from "node:path";
import { lint } from "../scripts/lint-ontology";

const fixturesDir = resolve(__dirname, "fixtures/ontology");

function fixture(name: string): string {
  return resolve(fixturesDir, name);
}

describe("ontology-lint — Rule 1: entity_facts.value must be numeric", () => {
  it("reports a violation when value column is text", () => {
    const violations = lint([fixture("rule1-violation.sql")]);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.rule === "rule1")).toBe(true);
    expect(violations.some((v) => v.detail.includes("text"))).toBe(true);
  });

  it("passes when value column is numeric", () => {
    const violations = lint([fixture("rule1-pass.sql")]);
    expect(violations.filter((v) => v.rule === "rule1")).toHaveLength(0);
  });
});

describe("ontology-lint — Rule 2: fact_type key references must be declared before use", () => {
  it("reports a violation when a referenced key was never inserted", () => {
    const violations = lint([fixture("rule2-violation.sql")]);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.rule === "rule2")).toBe(true);
    expect(violations.some((v) => v.detail.includes("nonexistent_key"))).toBe(true);
  });

  it("passes when the key is inserted in the same file before it is referenced", () => {
    const violations = lint([fixture("rule2-pass.sql")]);
    expect(violations.filter((v) => v.rule === "rule2")).toHaveLength(0);
  });

  it("passes when the key is inserted in an earlier migration file", () => {
    // rule2-pass.sql inserts 'revenue' then references it; rule2-violation.sql references
    // 'nonexistent_key' which is never inserted in either file.
    // Providing pass file first, violation file second: 'revenue' accumulates,
    // 'nonexistent_key' is still missing → only that key should be flagged.
    const violations = lint([fixture("rule2-pass.sql"), fixture("rule2-violation.sql")]);
    const rule2 = violations.filter((v) => v.rule === "rule2");
    expect(rule2.every((v) => v.detail.includes("nonexistent_key"))).toBe(true);
  });
});

describe("ontology-lint — Rule 3: top-level tables must match the ontology shape", () => {
  it("reports a violation for a table outside the allowed names and prefixes", () => {
    const violations = lint([fixture("rule3-violation.sql")]);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.rule === "rule3")).toBe(true);
    expect(violations.some((v) => v.detail.includes("user_preferences"))).toBe(true);
  });

  it("passes for ontology-named tables and dim_/fact_ prefixed tables", () => {
    const violations = lint([fixture("rule3-pass.sql")]);
    expect(violations.filter((v) => v.rule === "rule3")).toHaveLength(0);
  });
});
