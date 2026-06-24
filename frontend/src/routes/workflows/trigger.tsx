import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { supabase } from "@/data/supabase";
import { type WorkflowDefinition, workflowDefinitions } from "@/workflows/definitions";

interface TriggerWorkflowResponse {
  workflow_id: string;
  run_id: string;
}

const DEFAULT_FUNCTIONS_BASE_URL = "http://localhost:54321/functions/v1";
const DEFAULT_TEMPORAL_UI_URL = "http://localhost:8081";
const DEFAULT_TEMPORAL_NAMESPACE = "default";

function buildTemporalTraceUrl(workflowId: string, runId: string): string {
  const temporalUiUrl = import.meta.env.VITE_TEMPORAL_UI_URL || DEFAULT_TEMPORAL_UI_URL;
  const namespace = import.meta.env.VITE_TEMPORAL_NAMESPACE || DEFAULT_TEMPORAL_NAMESPACE;
  return `${temporalUiUrl}/namespaces/${encodeURIComponent(namespace)}/workflows/${encodeURIComponent(workflowId)}/${encodeURIComponent(runId)}/history`;
}

function seededInputFromSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") {
    return {};
  }

  const schemaRecord = schema as Record<string, unknown>;
  const typeValue = schemaRecord.type;

  if (typeValue === "object") {
    const properties = schemaRecord.properties as Record<string, unknown> | undefined;
    if (!properties) {
      return {};
    }

    const seededObject: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties)) {
      seededObject[key] = seededInputFromSchema(value);
    }
    return seededObject;
  }

  if (typeValue === "array") {
    return [];
  }

  if (typeValue === "number" || typeValue === "integer") {
    return 0;
  }

  if (typeValue === "boolean") {
    return false;
  }

  return "";
}

function initialEditorValue(definition: WorkflowDefinition | undefined): string {
  const seededInput = definition?.input_schema
    ? seededInputFromSchema(definition.input_schema)
    : {};
  return JSON.stringify(seededInput, null, 2);
}

export const Route = createFileRoute("/workflows/trigger")({
  component: TriggerWorkflowPage,
});

function TriggerWorkflowPage() {
  const [selectedDefinitionName, setSelectedDefinitionName] = useState<string>(
    workflowDefinitions[0]?.name ?? ""
  );
  const selectedDefinition = useMemo(
    () => workflowDefinitions.find((definition) => definition.name === selectedDefinitionName),
    [selectedDefinitionName]
  );
  const [inputText, setInputText] = useState<string>(() =>
    initialEditorValue(workflowDefinitions[0])
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<TriggerWorkflowResponse | null>(null);

  const parsedInput = useMemo(() => {
    try {
      return { value: JSON.parse(inputText) as unknown, error: null };
    } catch (error) {
      return {
        value: null,
        error: error instanceof Error ? error.message : "Input payload must be valid JSON.",
      };
    }
  }, [inputText]);

  const submitDisabled =
    isSubmitting ||
    !selectedDefinition ||
    parsedInput.error !== null ||
    parsedInput.value === null ||
    typeof parsedInput.value !== "object" ||
    Array.isArray(parsedInput.value);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitDisabled || !selectedDefinition || !parsedInput.value) {
      return;
    }

    setSubmitError(null);
    setResult(null);
    setIsSubmitting(true);

    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      const authorizationHeader = accessToken ? ["Bearer", accessToken].join(" ") : undefined;
      const apiUrl = `${import.meta.env.VITE_API_URL || DEFAULT_FUNCTIONS_BASE_URL}/trigger-workflow`;

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authorizationHeader ? { Authorization: authorizationHeader } : {}),
        },
        body: JSON.stringify({
          definition_name: selectedDefinition.name,
          input: parsedInput.value,
        }),
      });

      const payload = (await response.json()) as Partial<TriggerWorkflowResponse> & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Workflow trigger failed.");
      }

      if (!payload.workflow_id || !payload.run_id) {
        throw new Error("Trigger response did not include workflow_id and run_id.");
      }

      setResult({
        workflow_id: payload.workflow_id,
        run_id: payload.run_id,
      });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Workflow trigger failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="max-w-5xl mx-auto space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Trigger workflow</h1>
        <p className="text-sm text-muted-foreground">
          Select a DSL definition, provide JSON input, and submit a new DSL workflow execution.
        </p>
      </header>

      <div className="rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold mb-3">Available definitions</h2>
        <ul className="space-y-2">
          {workflowDefinitions.map((definition) => (
            <li key={`${definition.name}-${definition.version}`} className="rounded-lg border p-3">
              <p className="font-medium">{definition.name}</p>
              <p className="text-xs text-muted-foreground">
                {definition.description || "No description"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Version: {definition.version}</p>
            </li>
          ))}
        </ul>
      </div>

      <form className="space-y-4" onSubmit={onSubmit}>
        <label className="block space-y-2">
          <span className="text-sm font-medium">Definition</span>
          <select
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            data-testid="workflow-definition-select"
            value={selectedDefinitionName}
            onChange={(event) => {
              const definition = workflowDefinitions.find(
                (item) => item.name === event.target.value
              );
              setSelectedDefinitionName(event.target.value);
              setInputText(initialEditorValue(definition));
              setSubmitError(null);
              setResult(null);
            }}
          >
            {workflowDefinitions.map((definition) => (
              <option key={definition.name} value={definition.name}>
                {definition.name} ({definition.version})
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-medium">Input JSON</span>
          <textarea
            className="w-full min-h-72 rounded-md border bg-background p-3 font-mono text-sm"
            data-testid="workflow-input-editor"
            spellCheck={false}
            value={inputText}
            onChange={(event) => {
              setInputText(event.target.value);
              setSubmitError(null);
              setResult(null);
            }}
          />
        </label>

        {parsedInput.error ? (
          <p className="text-sm text-red-600" data-testid="workflow-input-error">
            Input JSON is invalid: {parsedInput.error}
          </p>
        ) : null}

        {submitError ? (
          <p className="text-sm text-red-600" data-testid="workflow-trigger-error">
            {submitError}
          </p>
        ) : null}

        <button
          className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          data-testid="workflow-trigger-submit"
          disabled={submitDisabled}
          type="submit"
        >
          {isSubmitting ? "Submitting..." : "Start workflow"}
        </button>
      </form>

      {result ? (
        <div
          className="rounded-xl border border-green-300 bg-green-50 p-4 text-sm"
          data-testid="workflow-trigger-success"
        >
          <p className="font-medium text-green-800">Workflow started</p>
          <p className="text-green-900">
            Workflow ID:{" "}
            <code data-testid="workflow-trigger-success-workflow-id">{result.workflow_id}</code>
          </p>
          <p className="text-green-900">
            Run ID: <code data-testid="workflow-trigger-success-run-id">{result.run_id}</code>
          </p>
          <a
            className="mt-2 inline-block text-green-800 underline"
            href={buildTemporalTraceUrl(result.workflow_id, result.run_id)}
            rel="noreferrer"
            target="_blank"
          >
            Open execution trace
          </a>
        </div>
      ) : null}
    </section>
  );
}
