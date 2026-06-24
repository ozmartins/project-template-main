import { basename } from "node:path";
import { readFileSync } from "node:fs";

export interface PullRequestFile {
  filename: string;
  status: string;
  previous_filename?: string;
}

export interface DefinitionChangeSummary {
  fileLabel: string;
  status: string;
  steps: string[];
  llmCalls: number;
  llmBreakdown: string[];
  toolsUsed: string[];
  externalServices: string[];
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

function asRecord(value: JsonValue | unknown): Record<string, JsonValue> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, JsonValue>;
}

function asArray(value: JsonValue | unknown): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function firstFrom(value: JsonValue | unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function cleanModelLabel(modelId: string): string {
  const v = modelId.toLowerCase();
  if (v.includes("haiku")) return "haiku";
  if (v.includes("sonnet")) return "sonnet";
  if (v.includes("opus")) return "opus";
  return modelId;
}

function activitySummary(activity: Record<string, JsonValue>): string {
  const name = firstFrom(activity["name"]) ?? "activity";
  const args = asRecord(activity["args"]) ?? {};
  const result = firstFrom(activity["result"]);

  if (name === "llm_agent") {
    const provider = firstFrom(args["provider"]);
    const modelId = firstFrom(args["model_id"]);
    const tools = asArray(args["tools"])
      .map((tool) => firstFrom(asRecord(tool)?.["name"]))
      .filter((tool): tool is string => Boolean(tool));

    const providerModel =
      provider && modelId ? ` (${provider}/${modelId})` : provider ? ` (${provider})` : modelId ? ` (${modelId})` : "";
    const toolsText = tools.length > 0 ? ` — tools: [${tools.join(", ")}]` : "";
    return `\`${name}\`${providerModel}${toolsText}`;
  }

  if (name === "web_search") {
    const query = firstFrom(args["query"]);
    return query ? `\`${name}\` — query: \`${query}\`` : `\`${name}\``;
  }

  if (name === "supabase_mutate" || name === "supabase_query") {
    const table = firstFrom(args["table"]);
    return table ? `\`${name}\` — table: \`${table}\`` : `\`${name}\``;
  }

  if (name === "domain_probe" && result) {
    return `\`${name}\` → result: \`${result}\``;
  }

  return result ? `\`${name}\` → result: \`${result}\`` : `\`${name}\``;
}

function summariseConditionElse(node: JsonValue | unknown): string {
  const record = asRecord(node);
  if (!record) return "execute else branch";
  if (record["activity"]) {
    const activity = asRecord(record["activity"]);
    const name = firstFrom(activity?.["name"]);
    return name ? `execute \`${name}\`` : "execute activity";
  }
  if (record["set_variable"]) return "set variable";
  if (record["sequence"]) return "execute sequence";
  return "execute else branch";
}

function collectStepLines(node: JsonValue | unknown, steps: string[]): void {
  const record = asRecord(node);
  if (!record) return;

  if (record["activity"]) {
    const activity = asRecord(record["activity"]);
    if (activity) steps.push(activitySummary(activity));
    return;
  }

  if (record["condition"]) {
    const condition = asRecord(record["condition"]) ?? {};
    const conditionExpr = firstFrom(condition["if"]) ?? "<expression>";
    const elseSummary = summariseConditionElse(condition["else"]);
    steps.push(`\`condition\` — if \`${conditionExpr}\` → ${elseSummary}`);
    collectStepLines(condition["then"], steps);
    return;
  }

  if (record["sequence"]) {
    const sequence = asRecord(record["sequence"]) ?? {};
    for (const step of asArray(sequence["steps"])) {
      collectStepLines(step, steps);
    }
    return;
  }

  if (record["parallel"]) {
    const parallel = asRecord(record["parallel"]) ?? {};
    const branches = asArray(parallel["branches"]);
    steps.push(`\`parallel\` — ${branches.length} branches`);
    for (const branch of branches) collectStepLines(branch, steps);
    return;
  }

  if (record["for_each"]) {
    const forEach = asRecord(record["for_each"]) ?? {};
    const eachExpr = firstFrom(forEach["items"]) ?? "<items>";
    steps.push(`\`for_each\` — in \`${eachExpr}\``);
    collectStepLines(forEach["body"], steps);
    return;
  }

  if (record["try_catch"]) {
    const tryCatch = asRecord(record["try_catch"]) ?? {};
    steps.push("`try_catch`");
    collectStepLines(tryCatch["try"], steps);
    const catchBlock = asRecord(tryCatch["catch"]);
    if (catchBlock) collectStepLines(catchBlock["body"], steps);
    if (tryCatch["finally"]) collectStepLines(tryCatch["finally"], steps);
  }
}

function collectLlmBreakdown(node: JsonValue | unknown, modelCounts: Map<string, number>): void {
  const record = asRecord(node);
  if (!record) return;

  if (record["activity"]) {
    const activity = asRecord(record["activity"]);
    if (firstFrom(activity?.["name"]) !== "llm_agent") return;
    const model = firstFrom(asRecord(activity?.["args"])?.["model_id"]);
    const label = model ? cleanModelLabel(model) : "unknown model";
    modelCounts.set(label, (modelCounts.get(label) ?? 0) + 1);
    return;
  }

  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      for (const item of value) collectLlmBreakdown(item, modelCounts);
      continue;
    }
    collectLlmBreakdown(value, modelCounts);
  }
}

function collectTools(node: JsonValue | unknown, tools: Set<string>): void {
  const record = asRecord(node);
  if (!record) return;

  if (record["activity"]) {
    const activity = asRecord(record["activity"]);
    if (firstFrom(activity?.["name"]) !== "llm_agent") return;
    const args = asRecord(activity?.["args"]) ?? {};
    for (const tool of asArray(args["tools"])) {
      const name = firstFrom(asRecord(tool)?.["name"]);
      if (name) tools.add(name);
    }
    return;
  }

  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      for (const item of value) collectTools(item, tools);
      continue;
    }
    collectTools(value, tools);
  }
}

const EXTERNAL_SERVICE_BY_ACTIVITY: Record<string, string> = {
  web_search: "Exa Search",
  web_crawl: "Exa Search",
  company_crawl: "Exa Search",
  supabase_mutate: "Supabase",
  supabase_query: "Supabase",
  email_send: "Email Delivery",
};

function collectExternalServices(node: JsonValue | unknown, services: Set<string>): void {
  const record = asRecord(node);
  if (!record) return;

  if (record["activity"]) {
    const activity = asRecord(record["activity"]);
    const name = firstFrom(activity?.["name"]) ?? "";
    const service = EXTERNAL_SERVICE_BY_ACTIVITY[name];
    if (service) services.add(service);
    return;
  }

  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      for (const item of value) collectExternalServices(item, services);
      continue;
    }
    collectExternalServices(value, services);
  }
}

export function listChangedDefinitionFiles(files: PullRequestFile[]): PullRequestFile[] {
  return files.filter(
    (file) =>
      file.filename.startsWith("temporal/definitions/") ||
      (file.previous_filename ? file.previous_filename.startsWith("temporal/definitions/") : false)
  );
}

export function summariseDefinitionChange(
  file: PullRequestFile,
  fileContent?: string
): DefinitionChangeSummary {
  const fileLabel = basename(file.filename);
  if (!fileContent) {
    return {
      fileLabel,
      status: file.status,
      steps: ["Definition content is unavailable in this revision."],
      llmCalls: 0,
      llmBreakdown: [],
      toolsUsed: [],
      externalServices: [],
    };
  }

  let parsed: JsonValue;
  try {
    parsed = JSON.parse(fileContent) as JsonValue;
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JSON";
    return {
      fileLabel,
      status: file.status,
      steps: [`Failed to parse definition JSON: ${message}`],
      llmCalls: 0,
      llmBreakdown: [],
      toolsUsed: [],
      externalServices: [],
    };
  }
  const root = asRecord(parsed) ?? {};
  const stepsRoot = root["steps"];
  const steps: string[] = [];
  collectStepLines(stepsRoot, steps);

  const modelCounts = new Map<string, number>();
  collectLlmBreakdown(stepsRoot, modelCounts);
  const llmBreakdown = [...modelCounts.entries()].map(([model, count]) => `${count}× ${model}`);

  const tools = new Set<string>();
  collectTools(stepsRoot, tools);

  const services = new Set<string>();
  collectExternalServices(stepsRoot, services);

  return {
    fileLabel,
    status: file.status,
    steps,
    llmCalls: [...modelCounts.values()].reduce((acc, n) => acc + n, 0),
    llmBreakdown,
    toolsUsed: [...tools],
    externalServices: [...services],
  };
}

export function renderDslDefinitionChangesComment(summaries: DefinitionChangeSummary[]): string {
  if (summaries.length === 0) return "";

  const lines = ["<!-- dsl-definition-changes -->", "## DSL Definition Changes", ""];

  for (const summary of summaries) {
    lines.push(`### ${summary.fileLabel} (${summary.status})`, "");
    lines.push("**Steps:**");
    if (summary.steps.length === 0) {
      lines.push("1. _No executable steps discovered_");
    } else {
      summary.steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
    }
    lines.push("");
    const breakdown = summary.llmBreakdown.length > 0 ? ` (${summary.llmBreakdown.join(", ")})` : "";
    lines.push(`**LLM calls:** ${summary.llmCalls}${breakdown}`);
    lines.push(
      `**Tools used:** ${summary.toolsUsed.length > 0 ? summary.toolsUsed.join(", ") : "none"}`
    );
    lines.push(
      `**External services:** ${
        summary.externalServices.length > 0 ? summary.externalServices.join(", ") : "none"
      }`
    );
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

export function loadDefinitionFile(path: string): string {
  return readFileSync(path, "utf8");
}
