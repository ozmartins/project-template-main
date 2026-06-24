export const DEFAULT_LOCAL_SUPABASE_URL = "http://127.0.0.1:54321";
export const MISSING_SUPABASE_SERVICE_ROLE_KEY = "REQUIRED_SUPABASE_SERVICE_ROLE_KEY";
export const UNINJECTED_SUPABASE_SERVICE_ROLE_KEY = "injected-by-make-up";

export const config = {
  // Temporal
  get temporalAddress() {
    return process.env.TEMPORAL_ADDRESS ?? "temporal:7233";
  },
  get temporalNamespace() {
    return process.env.TEMPORAL_NAMESPACE ?? "default";
  },
  get temporalTaskQueue() {
    return process.env.TEMPORAL_TASK_QUEUE ?? "main";
  },

  // Supabase
  get supabaseUrl() {
    return process.env.SUPABASE_URL ?? DEFAULT_LOCAL_SUPABASE_URL;
  },
  get supabaseServiceKey() {
    return process.env.SUPABASE_SERVICE_ROLE_KEY ?? MISSING_SUPABASE_SERVICE_ROLE_KEY;
  },
  get databaseUrl() {
    return process.env.DATABASE_URL ?? "";
  },

  // LLM provider selection for llm_agent activity (via @earendil-works/pi-ai).
  // These are defaults — individual workflow steps can override provider/model_id in their args.
  // Provider-specific API keys are read directly from env vars by pi-ai:
  //   Anthropic:   ANTHROPIC_API_KEY
  //   OpenAI:      OPENAI_API_KEY
  //   Azure:       AZURE_OPENAI_API_KEY + AZURE_OPENAI_BASE_URL
  //                (or AZURE_API_KEY + AZURE_API_BASE aliases; canonical names win if both are set)
  //   Bedrock:     AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION
  //   Google:      GOOGLE_API_KEY (or Application Default Credentials)
  //   OpenRouter:  OPENROUTER_API_KEY
  //   Groq:        GROQ_API_KEY
  //   Mistral:     MISTRAL_API_KEY
  //   (see @earendil-works/pi-ai README for full list)
  get piAgentProvider() {
    return process.env.PIAGENT_PROVIDER ?? "anthropic";
  },
  get piAgentModelId() {
    return process.env.PIAGENT_MODEL_ID ?? "claude-sonnet-4-6";
  },

  // Exa Search (web_search / web_crawl)
  get exaApiKey() {
    return process.env.EXA_API_KEY ?? "";
  },
};
