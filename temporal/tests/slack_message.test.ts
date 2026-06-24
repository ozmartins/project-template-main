jest.mock("@temporalio/activity", () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

import { log } from "@temporalio/activity";
import { slack_message } from "../src/activities/slack_message";

const originalEnv = { ...process.env };
const originalFetch = global.fetch;

afterEach(() => {
  process.env = { ...originalEnv };
  global.fetch = originalFetch;
  jest.clearAllMocks();
});

describe("slack_message", () => {
  it("posts via bot token mode when SLACK_BOT_TOKEN is configured", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
    delete process.env.SLACK_WEBHOOK_URL;

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, ts: "1741217000.000100", channel: "C123" }),
    } as Response);

    const result = await slack_message({
      channel: "C123",
      text: "Hello from Temporal",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "Hello" } }],
      thread_ts: "1741210000.000001",
      _idempotency_key: "slack-bot-idempotency",
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://slack.com/api/chat.postMessage",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Idempotency-Key": "slack-bot-idempotency",
        }),
      })
    );
    const fetchCalls = (global.fetch as jest.Mock).mock.calls;
    expect(fetchCalls.length).toBe(1);
    const headers = fetchCalls[0]?.[1]?.headers as Record<string, string>;
    const expectedAuthorization = ["Bearer", process.env.SLACK_BOT_TOKEN].join(" ");
    expect(headers.Authorization).toBe(expectedAuthorization);
    expect(result).toEqual({ ts: "1741217000.000100", channel: "C123" });
  });

  it("throws when Slack bot response is missing ts", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
    delete process.env.SLACK_WEBHOOK_URL;

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, channel: "C123" }),
    } as Response);

    await expect(
      slack_message({
        channel: "C123",
        text: "Hello from Temporal",
        _idempotency_key: "slack-bot-idempotency",
      })
    ).rejects.toThrow("slack_message: Slack chat.postMessage response missing ts");
  });

  it("posts via webhook mode when only SLACK_WEBHOOK_URL is configured", async () => {
    delete process.env.SLACK_BOT_TOKEN;
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/T000/B000/XXXX";

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => "ok",
    } as Response);

    const result = await slack_message({
      channel: "C987",
      text: "Webhook message",
      _idempotency_key: "slack-webhook-idempotency",
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/T000/B000/XXXX",
      expect.objectContaining({
        method: "POST",
      })
    );
    expect(result).toEqual({ ts: "webhook:slack-webhook-idempotency", channel: "C987" });
  });

  it("returns a stub result with warning when no Slack credentials are configured", async () => {
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_WEBHOOK_URL;
    global.fetch = jest.fn();

    const result = await slack_message({
      channel: "C456",
      text: "Fallback message",
      _idempotency_key: "slack-stub-idempotency",
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result).toEqual({ ts: "stub", channel: "C456" });
    expect((log.warn as jest.Mock).mock.calls.length).toBeGreaterThan(0);
  });
});

describe.skip("slack_message e2e (requires real Slack workspace credentials)", () => {
  it("e2e: sends a message using bot token or webhook credentials", async () => {
    if (!process.env.SLACK_E2E_CHANNEL) {
      throw new Error("Set SLACK_E2E_CHANNEL before running this e2e test.");
    }

    if (!process.env.SLACK_BOT_TOKEN && !process.env.SLACK_WEBHOOK_URL) {
      throw new Error(
        "Set SLACK_BOT_TOKEN (preferred) or SLACK_WEBHOOK_URL before running this e2e test."
      );
    }

    if (process.env.SLACK_E2E_THREAD_TS && !/^\d+\.\d+$/.test(process.env.SLACK_E2E_THREAD_TS)) {
      throw new Error(
        "SLACK_E2E_THREAD_TS must be in Slack timestamp format (for example 1741210000.000001)."
      );
    }

    const result = await slack_message({
      channel: process.env.SLACK_E2E_CHANNEL,
      text: "Temporal slack_message e2e test",
      thread_ts: process.env.SLACK_E2E_THREAD_TS,
      _idempotency_key: `slack-message-e2e-${process.env.SLACK_E2E_CHANNEL}-${Date.now()}`,
    });

    expect(result.channel).toBe(process.env.SLACK_E2E_CHANNEL);
    expect(result.ts.length).toBeGreaterThan(0);
  });
});
