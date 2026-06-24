jest.mock("@temporalio/activity", () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

import { email_send } from "../src/activities/email_send";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("email_send", () => {
  it("returns stub response when no provider key is configured", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.SENDGRID_API_KEY;

    const result = await email_send({
      to: "test@example.com",
      subject: "Test subject",
      body_html: "<p>Test body</p>",
      body_text: "Test body",
      _idempotency_key: "stub-test-key",
    });

    expect(result).toEqual({
      message_id: "stub",
      provider: "stub",
      delivered: false,
    });
  });
});

describe.skip("email_send e2e (requires real RESEND_API_KEY - run locally only)", () => {
  it("e2e: sends real email via Resend and returns delivered true", async () => {
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !process.env.EMAIL_E2E_TO) {
      throw new Error(
        "Set RESEND_API_KEY, EMAIL_FROM, and EMAIL_E2E_TO before running this e2e test."
      );
    }

    const result = await email_send({
      to: process.env.EMAIL_E2E_TO,
      from: process.env.EMAIL_FROM,
      subject: "Temporal email_send e2e test",
      body_html: "<p>Temporal e2e email send test</p>",
      body_text: "Temporal e2e email send test",
      _idempotency_key: `email-send-e2e-${Date.now()}`,
    });

    expect(result.delivered).toBe(true);
    expect(result.provider).toBe("resend");
    expect(result.message_id.length).toBeGreaterThan(0);
  });
});
