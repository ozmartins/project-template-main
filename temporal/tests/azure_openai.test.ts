/**
 * Unit tests for temporal/src/azure_openai.ts
 *
 * Directly tests the two exported helpers used by llm_agent and all Azure
 * smoke scripts to resolve env-var aliases and deployment names.
 *
 * Issue #62 context: gpt-5.4 returns 404 DeploymentNotFound on
 * volarisiaisandboxazureopenai.openai.azure.com.  The confirmed active
 * deployment is gpt-4o.  resolveAzureDeploymentName must throw — not silently
 * fall back — when no deployment name is configured.
 */

import { normalizeAzureOpenAiEnv, resolveAzureDeploymentName } from "../src/azure_openai";

// ── normalizeAzureOpenAiEnv ───────────────────────────────────────────────

describe("normalizeAzureOpenAiEnv", () => {
  function makeEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
    return { ...overrides };
  }

  it("aliases AZURE_API_KEY to AZURE_OPENAI_API_KEY", () => {
    const env = makeEnv({ AZURE_API_KEY: "legacy-api-key" });
    normalizeAzureOpenAiEnv(env);
    expect(env.AZURE_OPENAI_API_KEY).toBe("legacy-api-key");
  });

  it("does not overwrite AZURE_OPENAI_API_KEY when already set", () => {
    const env = makeEnv({
      AZURE_OPENAI_API_KEY: "canonical-key",
      AZURE_API_KEY: "legacy-key",
    });
    normalizeAzureOpenAiEnv(env);
    expect(env.AZURE_OPENAI_API_KEY).toBe("canonical-key");
  });

  it("aliases AZURE_OPENAI_ENDPOINT to AZURE_OPENAI_BASE_URL", () => {
    const env = makeEnv({
      AZURE_OPENAI_ENDPOINT: "https://sdk-name.openai.azure.com",
    });
    normalizeAzureOpenAiEnv(env);
    expect(env.AZURE_OPENAI_BASE_URL).toBe("https://sdk-name.openai.azure.com");
  });

  it("aliases AZURE_API_BASE to AZURE_OPENAI_BASE_URL", () => {
    const env = makeEnv({
      AZURE_API_BASE: "https://volarisiaisandboxazureopenai.openai.azure.com",
    });
    normalizeAzureOpenAiEnv(env);
    expect(env.AZURE_OPENAI_BASE_URL).toBe("https://volarisiaisandboxazureopenai.openai.azure.com");
  });

  it("AZURE_OPENAI_ENDPOINT takes precedence over AZURE_API_BASE", () => {
    const env = makeEnv({
      AZURE_OPENAI_ENDPOINT: "https://sdk-name.openai.azure.com",
      AZURE_API_BASE: "https://legacy-name.openai.azure.com",
    });
    normalizeAzureOpenAiEnv(env);
    expect(env.AZURE_OPENAI_BASE_URL).toBe("https://sdk-name.openai.azure.com");
  });

  it("does not overwrite AZURE_OPENAI_BASE_URL when already set", () => {
    const env = makeEnv({
      AZURE_OPENAI_BASE_URL: "https://canonical.openai.azure.com",
      AZURE_OPENAI_ENDPOINT: "https://should-be-ignored.openai.azure.com",
      AZURE_API_BASE: "https://also-ignored.openai.azure.com",
    });
    normalizeAzureOpenAiEnv(env);
    expect(env.AZURE_OPENAI_BASE_URL).toBe("https://canonical.openai.azure.com");
  });

  it("upgrades an old API version below 2025-03-01 to 2025-03-01-preview", () => {
    const env = makeEnv({ AZURE_API_VERSION: "2024-12-01-preview" });
    normalizeAzureOpenAiEnv(env);
    expect(env.AZURE_OPENAI_API_VERSION).toBe("2025-03-01-preview");
  });

  it("keeps a compatible API version (>= 2025-03-01) as-is", () => {
    const env = makeEnv({ AZURE_API_VERSION: "2025-03-01-preview" });
    normalizeAzureOpenAiEnv(env);
    expect(env.AZURE_OPENAI_API_VERSION).toBe("2025-03-01-preview");
  });

  it("keeps a newer compatible API version as-is", () => {
    const env = makeEnv({ AZURE_API_VERSION: "2025-06-01-preview" });
    normalizeAzureOpenAiEnv(env);
    expect(env.AZURE_OPENAI_API_VERSION).toBe("2025-06-01-preview");
  });

  it("sets default API version to 2025-03-01-preview when none provided", () => {
    const env = makeEnv({});
    normalizeAzureOpenAiEnv(env);
    expect(env.AZURE_OPENAI_API_VERSION).toBe("2025-03-01-preview");
  });

  it("does not overwrite AZURE_OPENAI_API_VERSION when already set", () => {
    const env = makeEnv({ AZURE_OPENAI_API_VERSION: "2025-05-01-preview" });
    normalizeAzureOpenAiEnv(env);
    expect(env.AZURE_OPENAI_API_VERSION).toBe("2025-05-01-preview");
  });

  it("returns the mutated env object", () => {
    const env = makeEnv({ AZURE_API_KEY: "k" });
    const result = normalizeAzureOpenAiEnv(env);
    expect(result).toBe(env);
  });
});

// ── resolveAzureDeploymentName ────────────────────────────────────────────

describe("resolveAzureDeploymentName", () => {
  it("returns PIAGENT_MODEL_ID when set (canonical deployment name)", () => {
    expect(resolveAzureDeploymentName({ PIAGENT_MODEL_ID: "gpt-4o" })).toBe("gpt-4o");
  });

  it("returns AZURE_OPENAI_DEPLOYMENT when PIAGENT_MODEL_ID is absent", () => {
    expect(resolveAzureDeploymentName({ AZURE_OPENAI_DEPLOYMENT: "gpt-4o" })).toBe("gpt-4o");
  });

  it("returns AZURE_API_DEPLOYMENT as last resort", () => {
    expect(resolveAzureDeploymentName({ AZURE_API_DEPLOYMENT: "legacy-deployment" })).toBe(
      "legacy-deployment"
    );
  });

  it("prefers PIAGENT_MODEL_ID over AZURE_OPENAI_DEPLOYMENT", () => {
    expect(
      resolveAzureDeploymentName({
        PIAGENT_MODEL_ID: "gpt-4o",
        AZURE_OPENAI_DEPLOYMENT: "other-deployment",
        AZURE_API_DEPLOYMENT: "legacy-deployment",
      })
    ).toBe("gpt-4o");
  });

  it("prefers AZURE_OPENAI_DEPLOYMENT over AZURE_API_DEPLOYMENT", () => {
    expect(
      resolveAzureDeploymentName({
        AZURE_OPENAI_DEPLOYMENT: "gpt-4o",
        AZURE_API_DEPLOYMENT: "legacy-deployment",
      })
    ).toBe("gpt-4o");
  });

  // ── issue #62 regression: must throw, not silently fall back ──────────
  it("throws with helpful message when no deployment name is configured", () => {
    expect(() =>
      resolveAzureDeploymentName({
        AZURE_OPENAI_BASE_URL: "https://volarisiaisandboxazureopenai.openai.azure.com",
      })
    ).toThrow(
      "Azure OpenAI deployment name required. " +
        "Resource: https://volarisiaisandboxazureopenai.openai.azure.com. " +
        "Set PIAGENT_MODEL_ID (preferred) or AZURE_OPENAI_DEPLOYMENT / AZURE_API_DEPLOYMENT."
    );
  });

  it("includes resource name from AZURE_API_BASE in the error when AZURE_OPENAI_BASE_URL absent", () => {
    expect(() =>
      resolveAzureDeploymentName({
        AZURE_API_BASE: "https://volarisiaisandboxazureopenai.openai.azure.com",
      })
    ).toThrow("Resource: https://volarisiaisandboxazureopenai.openai.azure.com");
  });

  it("uses generic resource label when no base URL env var is set", () => {
    expect(() => resolveAzureDeploymentName({})).toThrow("Resource: the configured Azure resource");
  });
});
