const RESPONSES_API_VERSION = "2025-03-01-preview";
const RESPONSES_API_MIN_DATE = RESPONSES_API_VERSION.replace(/-preview$/, "");

function isResponsesApiCompatibleVersion(version: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:-preview)?$/.exec(version);
  if (!match) return false;

  const [, yearText, monthText, dayText] = match;
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);
  const normalizedDate = `${yearText}-${monthText}-${dayText}`;

  return (
    Number.isFinite(month) &&
    month >= 1 &&
    month <= 12 &&
    Number.isFinite(day) &&
    day >= 1 &&
    day <= 31 &&
    normalizedDate >= RESPONSES_API_MIN_DATE
  );
}

export function normalizeAzureOpenAiEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (!env.AZURE_OPENAI_API_KEY && env.AZURE_API_KEY) {
    env.AZURE_OPENAI_API_KEY = env.AZURE_API_KEY;
  }
  if (!env.AZURE_OPENAI_BASE_URL && env.AZURE_OPENAI_ENDPOINT) {
    env.AZURE_OPENAI_BASE_URL = env.AZURE_OPENAI_ENDPOINT;
  }
  if (!env.AZURE_OPENAI_BASE_URL && env.AZURE_API_BASE) {
    env.AZURE_OPENAI_BASE_URL = env.AZURE_API_BASE;
  }
  if (!env.AZURE_OPENAI_API_VERSION) {
    const raw = env.AZURE_API_VERSION ?? "";
    env.AZURE_OPENAI_API_VERSION =
      raw !== "" && isResponsesApiCompatibleVersion(raw) ? raw : RESPONSES_API_VERSION;
  }
  return env;
}

export function resolveAzureDeploymentName(env: NodeJS.ProcessEnv = process.env): string {
  const deployment =
    env.PIAGENT_MODEL_ID ?? env.AZURE_OPENAI_DEPLOYMENT ?? env.AZURE_API_DEPLOYMENT;
  if (deployment) return deployment;
  const resource =
    env.AZURE_OPENAI_BASE_URL ?? env.AZURE_API_BASE ?? "the configured Azure resource";
  throw new Error(
    `Azure OpenAI deployment name required. Resource: ${resource}. ` +
      "Set PIAGENT_MODEL_ID (preferred) or AZURE_OPENAI_DEPLOYMENT / AZURE_API_DEPLOYMENT."
  );
}
