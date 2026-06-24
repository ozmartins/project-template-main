import definition from "../definitions/doc-extraction.json";
import { patchDefinitionForSmoke } from "../scripts/test-doc-extraction";

function getSequenceSteps(
  inputDefinition: Record<string, unknown>
): Array<Record<string, unknown>> {
  return (inputDefinition.steps as { sequence: { steps: Array<Record<string, unknown>> } }).sequence
    .steps;
}

describe("doc extraction definition and smoke patching", () => {
  it("contains the required workflow step sequence", () => {
    const steps = getSequenceSteps(definition as Record<string, unknown>);

    expect((steps[0].activity as { name: string }).name).toBe("http_request");
    expect((steps[1].activity as { name: string }).name).toBe("transform_data");
    expect((steps[2].activity as { name: string }).name).toBe("llm_agent");

    const gate = steps[3].condition as {
      if: string;
      then: { activity: { name: string } };
      else: { activity: { name: string } };
    };

    expect(gate.if).toBe("$var.extraction_response.parsed.confidence > 0.7");
    expect(gate.then.activity.name).toBe("supabase_mutate");
    expect(gate.else.activity.name).toBe("send_notification");
  });

  it("patches llm provider/model and routes writes to workflow_executions", () => {
    const patched = patchDefinitionForSmoke(
      definition as Record<string, unknown>,
      "openai",
      "gpt-4o"
    );
    const steps = getSequenceSteps(patched);

    const llmArgs = (steps[2].activity as { args: { provider: string; model_id: string } }).args;
    expect(llmArgs.provider).toBe("openai");
    expect(llmArgs.model_id).toBe("gpt-4o");

    const gate = steps[3].condition as {
      then: {
        activity: {
          args: {
            table: string;
            match: { workflow_id: string };
            values: {
              input_payload: { source_url: string };
              output_payload: { extracted_fields: string };
            };
          };
        };
      };
    };

    expect(gate.then.activity.args.table).toBe("workflow_executions");
    expect(gate.then.activity.args.match.workflow_id).toBe("$input.workflow_id");
    expect(gate.then.activity.args.values.input_payload.source_url).toBe("$input.source_url");
    expect(gate.then.activity.args.values.output_payload.extracted_fields).toBe(
      "$var.extraction_response.parsed"
    );
  });
});
