import { TestWorkflowEnvironment } from "@temporalio/testing";
import { DefaultLogger, Runtime, Worker } from "@temporalio/worker";
import definition from "../definitions/vertical-classification.json";
import { patchDefinitionForSmoke } from "../scripts/test-vertical-classification";

type Steps = { sequence: { steps: Array<Record<string, unknown>> } };
type ConditionStep = {
  condition: {
    if: string;
    then: Steps;
    else: Record<string, unknown>;
  };
};

function getTopLevelSteps(): Array<Record<string, unknown>> {
  return (definition.steps as Steps).sequence.steps;
}

function getConditionStep(): ConditionStep["condition"] {
  return (getTopLevelSteps()[2] as ConditionStep).condition;
}

function getThenSteps(): Array<Record<string, unknown>> {
  return getConditionStep().then.sequence.steps;
}

function getElseBranch(): Record<string, unknown> {
  return getConditionStep().else;
}

describe("vertical classification smoke definition patching", () => {
  function getActivePersistValues() {
    const thenSteps = getThenSteps();
    const persistStep = thenSteps[thenSteps.length - 1];
    return (persistStep.activity as { args: { values: Record<string, unknown> } }).args.values;
  }

  function getPatchedActivePersistArgs() {
    const patched = patchDefinitionForSmoke(
      definition as Record<string, unknown>,
      "openai",
      "gpt-4o"
    );
    const conditionStep = (patched.steps as Steps).sequence.steps[2] as ConditionStep;
    const thenSteps = conditionStep.condition.then.sequence.steps;
    const persistStep = thenSteps[thenSteps.length - 1];
    return (persistStep.activity as { args: { table: string; values: Record<string, unknown> } })
      .args;
  }

  it("keeps domain_probe aligned with the activity contract", () => {
    const probeStep = getTopLevelSteps()[0];
    expect((probeStep.activity as { args: { url: string } }).args.url).toBe("$input.domain");
  });

  it("routes smoke writes to workflow_classifications with confidence", () => {
    const originalValues = getActivePersistValues();
    const patchedArgs = getPatchedActivePersistArgs();
    const patchedJson = JSON.stringify(
      patchDefinitionForSmoke(definition as Record<string, unknown>, "openai", "gpt-4o")
    );

    expect(originalValues.classification_confidence).toBe("$var.classification_confidence");
    expect(patchedArgs.table).toBe("workflow_classifications");
    expect(patchedArgs.values.confidence).toBe("$var.classification_confidence");
    expect(patchedArgs.values.classification_confidence).toBeUndefined();
    expect(patchedJson).toContain('"provider":"openai"');
    expect(patchedJson).toContain('"model_id":"gpt-4o"');
  });
});

describe("condition branch: inactive domain skips LLM steps", () => {
  it("condition guard expression checks probe.domain_active", () => {
    expect(getConditionStep().if).toBe("$var.probe.domain_active == true");
  });

  it("else branch is a single supabase_mutate (no web_search or llm_agent calls)", () => {
    const elseBranch = getElseBranch();
    // Must be a direct activity node — not a sequence that could contain LLM steps
    expect(elseBranch).toHaveProperty("activity");
    expect((elseBranch.activity as { name: string }).name).toBe("supabase_mutate");
    expect(elseBranch).not.toHaveProperty("sequence");
  });

  it("else branch marks the company as inactive with lifecycle_stage defunct", () => {
    const elseBranch = getElseBranch();
    const values = (elseBranch.activity as { args: { values: Record<string, unknown> } }).args
      .values;
    expect(values.domain_active).toBe(false);
    expect(values.lifecycle_stage).toBe("defunct");
  });

  it("patchDefinitionForSmoke routes the else-branch write to workflow_classifications", () => {
    const patched = patchDefinitionForSmoke(
      definition as Record<string, unknown>,
      "openai",
      "gpt-4o"
    );
    const conditionStep = (patched.steps as Steps).sequence.steps[2] as ConditionStep;
    const elseBranch = conditionStep.condition.else;
    const args = (elseBranch.activity as { args: { table: string } }).args;
    expect(args.table).toBe("workflow_classifications");
  });

  it("then branch contains exactly 5 activity steps: web_search + 3× llm_agent + supabase_mutate", () => {
    const thenSteps = getThenSteps();
    const activityNames = thenSteps
      .filter((s) => s.activity !== undefined)
      .map((s) => (s.activity as { name: string }).name);
    expect(activityNames).toContain("web_search");
    expect(activityNames.filter((n) => n === "llm_agent")).toHaveLength(3);
    expect(activityNames).toContain("supabase_mutate");
    expect(activityNames).toHaveLength(5);
  });
});

describe("condition branch: inactive domain — behavioral (DSLWorkflow interpreter)", () => {
  let testEnv: TestWorkflowEnvironment;
  let worker: Worker;
  let workerRunPromise: Promise<void>;

  const calledActivities: string[] = [];
  const mutateCallArgs: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    Runtime.install({ logger: new DefaultLogger("WARN") });
    testEnv = await TestWorkflowEnvironment.createLocal();
    worker = await Worker.create({
      connection: testEnv.nativeConnection,
      namespace: "default",
      taskQueue: "vertical-classification-inactive",
      workflowsPath: require.resolve("../src/workflows"),
      activities: {
        domain_probe: async () => ({
          domain: "inactive.example.com",
          domain_active: false,
          dns_resolves: false,
          http_status: null,
          final_url: null,
          ssl_expiry_days: null,
        }),
        supabase_mutate: async (args: Record<string, unknown>) => {
          calledActivities.push("supabase_mutate");
          mutateCallArgs.push(structuredClone(args) as Record<string, unknown>);
          return { id: "stub-defunct-row" };
        },
        web_search: async () => {
          calledActivities.push("web_search");
          return { query: "stub", results: [] };
        },
        llm_agent: async () => {
          calledActivities.push("llm_agent");
          return { parsed: {}, prompt_tokens: 0, completion_tokens: 0 };
        },
        record_step: async (): Promise<string | undefined> => undefined,
        complete_execution: async (): Promise<void> => {},
      },
    });
    workerRunPromise = worker.run();
  }, 60_000);

  afterAll(async () => {
    await worker?.shutdown();
    await workerRunPromise;
    // suppress the known native-connection teardown race in @temporalio/testing
    await testEnv?.teardown().catch(() => {});
  }, 30_000);

  it("skips web_search and all llm_agent calls; writes the defunct fallback via supabase_mutate", async () => {
    calledActivities.length = 0;
    mutateCallArgs.length = 0;

    const result = (await testEnv.client.workflow.execute("DSLWorkflow", {
      args: [
        {
          definition: definition as Record<string, unknown>,
          input: {
            company_name: "Defunct Corp",
            domain: "inactive.example.com",
            run_at: new Date().toISOString(),
          },
        },
      ],
      taskQueue: "vertical-classification-inactive",
      workflowId: `inactive-branch-${Date.now()}`,
    })) as Record<string, unknown>;

    // domain_probe ran and its result is stored in vars
    const probe = result.probe as Record<string, unknown>;
    expect(probe.domain_active).toBe(false);

    // Only supabase_mutate fired — web_search and llm_agent were never invoked
    expect(calledActivities).not.toContain("web_search");
    expect(calledActivities).not.toContain("llm_agent");
    expect(calledActivities.filter((n) => n === "supabase_mutate")).toHaveLength(1);

    // The defunct fallback write carried the correct field values
    const mutateValues = mutateCallArgs[0].values as Record<string, unknown>;
    expect(mutateValues.domain_active).toBe(false);
    expect(mutateValues.lifecycle_stage).toBe("defunct");

    // LLM / search result variables were never populated in the workflow vars
    expect(result.search_results).toBeUndefined();
    expect(result.lifecycle_response).toBeUndefined();
    expect(result.broad_classification_response).toBeUndefined();
    expect(result.sub_classification_response).toBeUndefined();
  }, 30_000);
});
