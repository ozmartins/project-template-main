import { describe, expect, it } from "vitest";
import { buildAzureChatCompletionsUrl, extractAssistantContent } from "../azure-openai.js";

describe("buildAzureChatCompletionsUrl", () => {
  it("builds deployment endpoint and trims trailing slash", () => {
    const url = buildAzureChatCompletionsUrl(
      "https://example.services.ai.azure.com/",
      "gpt-5.4",
      "2024-12-01-preview"
    );
    expect(url).toBe(
      "https://example.services.ai.azure.com/openai/deployments/gpt-5.4/chat/completions?api-version=2024-12-01-preview"
    );
  });
});

describe("extractAssistantContent", () => {
  it("returns string content", () => {
    const result = extractAssistantContent({
      choices: [{ message: { content: "hello world" } }],
    });
    expect(result).toBe("hello world");
  });

  it("joins text content parts", () => {
    const result = extractAssistantContent({
      choices: [
        {
          message: {
            content: [
              { type: "text", text: "line one" },
              { type: "input_text", text: "ignore me" },
              { type: "text", text: "line two" },
            ],
          },
        },
      ],
    });
    expect(result).toBe("line one\nline two");
  });

  it("falls back when response content is missing", () => {
    expect(extractAssistantContent({ choices: [] })).toBe("(no response)");
  });
});
