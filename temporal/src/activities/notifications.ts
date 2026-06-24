import { log } from "@temporalio/activity";

export async function send_email(args: {
  to: string;
  subject: string;
  body: string;
  _idempotency_key?: string;
}): Promise<boolean> {
  log.info("[STUB] send_email", { to: args.to, subject: args.subject });
  return true;
}

export async function send_notification(args: {
  user_id: string;
  message: string;
  channel?: string;
  template?: string;
  data?: Record<string, unknown>;
  _idempotency_key?: string;
}): Promise<boolean> {
  log.info("[STUB] send_notification", {
    user_id: args.user_id,
    channel: args.channel ?? "in-app",
  });
  return true;
}
