type OpenAIContentPart = {
  type?: string;
  text?: string;
};

type OpenAIMessage = {
  content?: string | OpenAIContentPart[];
};

type OpenAIChoice = {
  message?: OpenAIMessage;
};

type OpenAIResponse = {
  choices?: OpenAIChoice[];
};

export function buildAzureChatCompletionsUrl(
  baseUrl: string,
  deployment: string,
  apiVersion: string
): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  return `${normalizedBase}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
}

export function extractAssistantContent(payload: unknown): string {
  const response = payload as OpenAIResponse;
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) {
    return content;
  }
  if (Array.isArray(content)) {
    const text = content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text!.trim())
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text) {
      return text;
    }
  }
  return "(no response)";
}
