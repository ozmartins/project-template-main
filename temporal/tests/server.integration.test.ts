import { serve } from "@hono/node-server";
import { createWorkflowApiApp } from "../src/server";

const runIntegration = process.env.RUN_TEMPORAL_API_INTEGRATION === "1";
const testOrSkip = runIntegration ? it : it.skip;

describe("workflow API server integration", () => {
  testOrSkip(
    "hits real HTTP endpoints with local Temporal + Supabase",
    async () => {
      process.env.SUPABASE_URL ??= "http://127.0.0.1:54321";
      process.env.TEMPORAL_ADDRESS ??= "127.0.0.1:7234";
      process.env.TEMPORAL_NAMESPACE ??= "default";
      process.env.TEMPORAL_TASK_QUEUE ??= "main";
      process.env.FRONTEND_ORIGIN ??= "http://localhost:3000";

      const app = createWorkflowApiApp();

      const server = serve({ fetch: app.fetch, port: 3001 });
      try {
        const corsResponse = await fetch("http://127.0.0.1:3001/workflows/executions", {
          method: "OPTIONS",
          headers: {
            Origin: "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
          },
        });

        expect(corsResponse.status).toBe(204);
        expect(corsResponse.headers.get("access-control-allow-origin")).toBe(
          "http://localhost:3000"
        );

        const triggerResponse = await fetch("http://127.0.0.1:3001/workflows/trigger", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            definition_name: "vertical-classification",
            input: {
              company_name: "Stripe Inc",
              domain: "stripe.com",
            },
          }),
        });

        expect(triggerResponse.status).toBe(201);
        const triggerPayload = (await triggerResponse.json()) as {
          workflow_id: string;
          run_id: string;
          definition_name: string;
        };

        expect(triggerPayload.workflow_id).toBeTruthy();
        expect(triggerPayload.run_id).toBeTruthy();
        expect(triggerPayload.definition_name).toBe("vertical-classification");

        const listResponse = await fetch("http://127.0.0.1:3001/workflows/executions?limit=20");
        expect(listResponse.status).toBe(200);

        const detailResponse = await fetch(
          `http://127.0.0.1:3001/workflows/executions/${triggerPayload.workflow_id}`
        );
        expect(detailResponse.status).toBe(200);
      } finally {
        server.close();
      }
    },
    120_000
  );
});
