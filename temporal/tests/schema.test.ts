import { validateDefinition } from "../src/workflows/dsl/schema";

const minimal = {
  name: "test-wf",
  version: "1.0.0",
  steps: { activity: { name: "do_thing" } },
};

describe("validateDefinition", () => {
  it("accepts a minimal valid definition", () => {
    expect(() => validateDefinition(minimal)).not.toThrow();
  });

  it("rejects missing name", () => {
    expect(() => validateDefinition({ ...minimal, name: undefined })).toThrow(/name/);
  });

  it("rejects bad version format", () => {
    expect(() => validateDefinition({ ...minimal, version: "v1" })).toThrow(/semver/);
  });

  it("rejects missing steps", () => {
    const { steps: _, ...rest } = minimal;
    expect(() => validateDefinition(rest)).toThrow(/steps/);
  });

  it("rejects unknown step type", () => {
    expect(() => validateDefinition({ ...minimal, steps: { unknown_step: {} } })).toThrow(
      /unknown step type/
    );
  });

  it("rejects activity missing name", () => {
    expect(() => validateDefinition({ ...minimal, steps: { activity: {} } })).toThrow(/name/);
  });

  it("rejects step with multiple keys", () => {
    expect(() =>
      validateDefinition({
        ...minimal,
        steps: { activity: { name: "a" }, sequence: { steps: [] } },
      })
    ).toThrow(/exactly one/);
  });

  it("validates nested sequence", () => {
    expect(() =>
      validateDefinition({
        ...minimal,
        steps: {
          sequence: {
            steps: [{ activity: { name: "step_a" } }, { activity: { name: "step_b" } }],
          },
        },
      })
    ).not.toThrow();
  });

  it("validates condition step", () => {
    expect(() =>
      validateDefinition({
        ...minimal,
        steps: {
          condition: {
            if: "$var.x == true",
            // biome-ignore lint/suspicious/noThenProperty: DSL keyword, not a thenable
            then: { activity: { name: "do_a" } },
            else: { activity: { name: "do_b" } },
          },
        },
      })
    ).not.toThrow();
  });

  it("rejects condition missing then", () => {
    expect(() =>
      validateDefinition({
        ...minimal,
        steps: { condition: { if: "$var.x == true" } },
      })
    ).toThrow(/then/);
  });
});
