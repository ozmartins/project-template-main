import fs from "node:fs";
import path from "node:path";

const EXPECTED_AZURE_FALLBACK = "2025-03-01-preview";
const STALE_AZURE_FALLBACK = "2024-12-01-preview";

function readFileFromTemporalRoot(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8");
}

/** Returns every AZURE_OPENAI_API_VERSION fallback literal found in source. */
function extractAllApiVersionFallbacks(source: string): string[] {
  const regex = /AZURE_OPENAI_API_VERSION\s*\?\?\s*["']([^"']+)["']/g;
  return [...source.matchAll(regex)].map((m) => m[1]);
}

describe("Azure API version fallback contract in production call sites", () => {
  it("uses 2025-03-01-preview fallback in llm_agent when AZURE_OPENAI_API_VERSION is unset", () => {
    const llmAgentSource = readFileFromTemporalRoot("src/activities/llm_agent.ts");
    const fallbacks = extractAllApiVersionFallbacks(llmAgentSource);
    expect(fallbacks.length).toBeGreaterThan(0);
    for (const fallback of fallbacks) {
      expect(fallback).toBe(EXPECTED_AZURE_FALLBACK);
    }
    expect(llmAgentSource).not.toContain(STALE_AZURE_FALLBACK);
  });

  it("uses 2025-03-01-preview fallback in probe-llm when AZURE_OPENAI_API_VERSION is unset", () => {
    const probeLlmSource = readFileFromTemporalRoot("scripts/probe-llm.ts");
    const fallbacks = extractAllApiVersionFallbacks(probeLlmSource);
    expect(fallbacks.length).toBeGreaterThan(0);
    for (const fallback of fallbacks) {
      expect(fallback).toBe(EXPECTED_AZURE_FALLBACK);
    }
    expect(probeLlmSource).not.toContain(STALE_AZURE_FALLBACK);
  });

  it("keeps llm_agent and probe-llm fallback versions aligned", () => {
    const llmAgentSource = readFileFromTemporalRoot("src/activities/llm_agent.ts");
    const probeLlmSource = readFileFromTemporalRoot("scripts/probe-llm.ts");

    const workerFallbacks = extractAllApiVersionFallbacks(llmAgentSource);
    const probeFallbacks = extractAllApiVersionFallbacks(probeLlmSource);

    expect(workerFallbacks.length).toBeGreaterThan(0);
    expect(probeFallbacks.length).toBeGreaterThan(0);

    const uniqueWorker = [...new Set(workerFallbacks)];
    const uniqueProbe = [...new Set(probeFallbacks)];

    expect(uniqueWorker).toEqual([EXPECTED_AZURE_FALLBACK]);
    expect(uniqueProbe).toEqual([EXPECTED_AZURE_FALLBACK]);
    expect(uniqueWorker).toEqual(uniqueProbe);
  });

  it("smoke-test.ts delegates API version handling to normalizeAzureOpenAiEnv rather than hardcoding a fallback", () => {
    const smokeTestSource = readFileFromTemporalRoot("scripts/smoke-test.ts");
    const fallbacks = extractAllApiVersionFallbacks(smokeTestSource);
    // smoke-test.ts must NOT define its own AZURE_OPENAI_API_VERSION fallback literal —
    // it calls normalizeAzureOpenAiEnv() which centralises that logic in azure_openai.ts.
    // This guards against a future edit accidentally re-introducing a stale version here.
    expect(fallbacks).toHaveLength(0);
    expect(smokeTestSource).toContain("normalizeAzureOpenAiEnv");
    expect(smokeTestSource).not.toContain(STALE_AZURE_FALLBACK);
  });
});
