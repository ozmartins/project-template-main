import { log } from "@temporalio/activity";

const SLACK_BOT_TOKEN_ENV = "SLACK_BOT_TOKEN";
const SLACK_WEBHOOK_URL_ENV = "SLACK_WEBHOOK_URL";
const SLACK_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";

export interface SlackMessageArgs {
  channel: string;
  text: string;
  blocks?: object[];
  thread_ts?: string;
  _idempotency_key: string;
}

export interface SlackMessageResult {
  ts: string;
  channel: string;
}

interface SlackPostMessageResponse {
  ok: boolean;
  error?: string;
  ts?: string;
  channel?: string;
}

async function postViaBotToken(
  botToken: string,
  args: SlackMessageArgs
): Promise<SlackMessageResult> {
  const response = await fetch(SLACK_POST_MESSAGE_URL, {
    method: "POST",
    headers: {
      Authorization: "Bearer ".concat(botToken),
      "Content-Type": "application/json",
      "X-Idempotency-Key": args._idempotency_key,
    },
    body: JSON.stringify({
      channel: args.channel,
      text: args.text,
      blocks: args.blocks,
      thread_ts: args.thread_ts,
    }),
  });

  if (!response.ok) {
    throw new Error(`slack_message: Slack chat.postMessage failed (HTTP ${response.status})`);
  }

  const payload = (await response.json()) as SlackPostMessageResponse;
  if (!payload.ok) {
    throw new Error(
      `slack_message: Slack chat.postMessage returned error: ${payload.error ?? "unknown_error"}`
    );
  }
  if (!payload.ts) {
    throw new Error("slack_message: Slack chat.postMessage response missing ts");
  }

  return {
    ts: payload.ts,
    channel: payload.channel ?? args.channel,
  };
}

async function postViaWebhook(
  webhookUrl: string,
  args: SlackMessageArgs
): Promise<SlackMessageResult> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channel: args.channel,
      text: args.text,
      blocks: args.blocks,
      thread_ts: args.thread_ts,
    }),
  });

  if (!response.ok) {
    throw new Error(`slack_message: webhook delivery failed (HTTP ${response.status})`);
  }

  return {
    ts: `webhook:${args._idempotency_key}`,
    channel: args.channel,
  };
}

export async function slack_message(args: SlackMessageArgs): Promise<SlackMessageResult> {
  const botToken = process.env[SLACK_BOT_TOKEN_ENV];
  const webhookUrl = process.env[SLACK_WEBHOOK_URL_ENV];
  const logContext = {
    channel: args.channel,
    has_blocks: !!args.blocks?.length,
    has_thread_ts: !!args.thread_ts,
    has_bot_token: !!botToken,
    has_webhook_url: !!webhookUrl,
  };

  log.info("slack_message", logContext);

  if (botToken) return postViaBotToken(botToken, args);
  if (webhookUrl) return postViaWebhook(webhookUrl, args);

  log.warn(
    `slack_message: neither ${SLACK_BOT_TOKEN_ENV} nor ${SLACK_WEBHOOK_URL_ENV} is set — returning stub response`
  );
  return {
    ts: "stub",
    channel: args.channel,
  };
}
