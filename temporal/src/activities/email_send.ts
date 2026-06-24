import { log } from "@temporalio/activity";

const AUTH_SCHEME = "Bearer";

export interface EmailSendArgs {
  to: string | string[];
  subject: string;
  body_html: string;
  body_text?: string;
  from?: string;
  reply_to?: string;
  _idempotency_key: string;
}

export interface EmailSendResult {
  message_id: string;
  provider: "resend" | "sendgrid" | "stub";
  delivered: boolean;
}

function normalizeRecipients(to: string | string[]): string[] {
  return Array.isArray(to) ? to : [to];
}

function resolveFromAddress(args: EmailSendArgs): string {
  return args.from ?? process.env.EMAIL_FROM ?? "";
}

function providerHttpError(provider: "Resend" | "SendGrid", status: number): Error {
  return new Error(`email_send: ${provider} delivery failed (HTTP ${status})`);
}

async function sendViaResend(args: EmailSendArgs, apiKey: string): Promise<EmailSendResult> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `${AUTH_SCHEME} ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": args._idempotency_key,
    },
    body: JSON.stringify({
      from: resolveFromAddress(args),
      to: normalizeRecipients(args.to),
      subject: args.subject,
      html: args.body_html,
      text: args.body_text,
      reply_to: args.reply_to,
    }),
  });

  if (!response.ok) {
    throw providerHttpError("Resend", response.status);
  }

  const payload = (await response.json()) as { id?: string };
  return {
    message_id: payload.id ?? args._idempotency_key,
    provider: "resend",
    delivered: true,
  };
}

async function sendViaSendgrid(args: EmailSendArgs, apiKey: string): Promise<EmailSendResult> {
  const fromEmail = resolveFromAddress(args);
  const content: Array<{ type: string; value: string }> = [
    { type: "text/html", value: args.body_html },
  ];
  if (args.body_text) content.push({ type: "text/plain", value: args.body_text });

  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `${AUTH_SCHEME} ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": args._idempotency_key,
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: normalizeRecipients(args.to).map((email) => ({ email })),
          subject: args.subject,
        },
      ],
      from: { email: fromEmail },
      reply_to: args.reply_to ? { email: args.reply_to } : undefined,
      content,
    }),
  });

  if (!response.ok) {
    throw providerHttpError("SendGrid", response.status);
  }

  return {
    message_id: response.headers.get("x-message-id") ?? args._idempotency_key,
    provider: "sendgrid",
    delivered: true,
  };
}

export async function email_send(args: EmailSendArgs): Promise<EmailSendResult> {
  const resendApiKey = process.env.RESEND_API_KEY;
  const sendgridApiKey = process.env.SENDGRID_API_KEY;

  log.info("email_send", {
    to_count: Array.isArray(args.to) ? args.to.length : 1,
    has_resend_key: !!resendApiKey,
    has_sendgrid_key: !!sendgridApiKey,
  });

  if (resendApiKey) return sendViaResend(args, resendApiKey);
  if (sendgridApiKey) return sendViaSendgrid(args, sendgridApiKey);

  log.warn("email_send: no provider configured — returning stub response");
  return {
    message_id: "stub",
    provider: "stub",
    delivered: false,
  };
}
