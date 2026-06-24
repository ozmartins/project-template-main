import definition from "../definitions/lead-enrichment.json";
import { patchDefinitionForSmoke } from "../scripts/test-lead-enrichment";
import { validateDefinition } from "../src/workflows/dsl/schema";

describe("lead enrichment definition and smoke patching", () => {
  type Step = Record<string, unknown>;

  function getSteps(): Step[] {
    return (definition.steps as { sequence: { steps: Step[] } }).sequence.steps;
  }

  function findReviewStatusGate() {
    const step = getSteps().find((candidate) => {
      const condition = candidate.condition as
        | { if?: unknown; then?: { set_variable?: { name?: unknown } } }
        | undefined;
      return (
        condition?.if === "$var.confidence >= 0.7" &&
        condition.then?.set_variable?.name === "review_status"
      );
    });

    expect(step).toBeDefined();
    return (step as { condition: unknown }).condition as {
      if: string;
      then: { set_variable: { name: string; value: string } };
      else: { set_variable: { name: string; value: string } };
    };
  }

  function findPersistenceGate() {
    const step = getSteps().find((candidate) => {
      const condition = candidate.condition as
        | {
            if?: unknown;
            then?: { activity?: { name?: unknown; args?: { table?: unknown } } };
            else?: { activity?: { name?: unknown; args?: { table?: unknown } } };
          }
        | undefined;

      return (
        condition?.if === "$var.confidence >= 0.7" &&
        condition.then?.activity?.name === "supabase_mutate" &&
        condition.then?.activity?.args?.table === "entity_versions" &&
        condition.else?.activity?.name === "supabase_mutate" &&
        condition.else?.activity?.args?.table === "entity_versions"
      );
    });

    expect(step).toBeDefined();
    return (step as { condition: unknown }).condition as {
      if: string;
      then: { activity: { args: { values: { is_current: boolean } } } };
      else: { activity: { args: { values: { is_current: boolean } } } };
    };
  }

  it("uses the required input contract", () => {
    const schema = definition.input_schema as {
      required: string[];
      properties: Record<string, unknown>;
      additionalProperties: boolean;
    };

    expect(schema.required).toEqual(["person_name", "company_name"]);
    expect(Object.keys(schema.properties).sort()).toEqual(
      ["company_domain", "company_name", "person_name", "source_id"].sort()
    );
    expect(schema.additionalProperties).toBe(false);
  });

  it("passes DSL definition validation", () => {
    expect(() => validateDefinition(definition as Record<string, unknown>)).not.toThrow();
  });

  it("has explicit confidence routing at 0.7 threshold", () => {
    const condition = findReviewStatusGate();

    expect(condition.if).toBe("$var.confidence >= 0.7");
    expect(condition.then.set_variable.name).toBe("review_status");
    expect(condition.then.set_variable.value).toBe("ready");
    expect(condition.else.set_variable.name).toBe("review_status");
    expect(condition.else.set_variable.value).toBe("review_needed");
  });

  it("gates persisted is_current for both sides of 0.7", () => {
    const condition = findPersistenceGate();

    expect(condition.if).toBe("$var.confidence >= 0.7");
    expect(condition.then.activity.args.values.is_current).toBe(true);
    expect(condition.else.activity.args.values.is_current).toBe(false);
  });

  it("patches llm provider/model for smoke execution", () => {
    const patched = patchDefinitionForSmoke(
      definition as Record<string, unknown>,
      "openai",
      "gpt-4o"
    );
    const patchedJson = JSON.stringify(patched);

    expect(patchedJson).toContain('"provider":"openai"');
    expect(patchedJson).toContain('"model_id":"gpt-4o"');
  });
});
