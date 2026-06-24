import { NativeConnection, Worker } from "@temporalio/worker";
import * as dataValidate from "./activities/data_validate";
import * as domainProbe from "./activities/domain_probe";
import * as emailSend from "./activities/email_send";
import * as evaluateDecision from "./activities/evaluate_decision";
import * as executionTracking from "./activities/execution_tracking";
import * as fileExtract from "./activities/file_extract";
import * as httpRequest from "./activities/http_request";
import * as llmAgent from "./activities/llm_agent";
import * as llmEmbeddings from "./activities/llm_embeddings";
import * as notifications from "./activities/notifications";
import * as scheduleTrigger from "./activities/schedule_trigger";
import * as slackMessage from "./activities/slack_message";
import * as supabaseCore from "./activities/supabase_core";
import * as supabaseQuery from "./activities/supabase_query";
import * as transformData from "./activities/transform_data";
import * as vectorSearch from "./activities/vector_search";
import * as webCrawl from "./activities/web_crawl";
import * as webSearch from "./activities/web_search";
import { config } from "./config";
import { startWorkflowApiServer } from "./server";

async function main(): Promise<void> {
  startWorkflowApiServer();

  const connection = await NativeConnection.connect({ address: config.temporalAddress });

  const worker = await Worker.create({
    connection,
    namespace: config.temporalNamespace,
    taskQueue: config.temporalTaskQueue,
    workflowsPath: require.resolve("./workflows"),
    activities: {
      ...dataValidate,
      ...fileExtract,
      ...supabaseCore,
      ...notifications,
      ...slackMessage,
      ...httpRequest,
      ...supabaseQuery,
      ...evaluateDecision,
      ...transformData,
      ...llmAgent,
      ...llmEmbeddings,
      ...webSearch,
      ...webCrawl,
      ...vectorSearch,
      ...domainProbe,
      ...emailSend,
      ...scheduleTrigger,
      ...executionTracking,
    },
  });
  await worker.run();
}

main().catch((err) => {
  const details = err instanceof Error ? (err.stack ?? String(err)) : String(err);
  process.stderr.write(`Worker fatal error ${details}\n`);
  process.exit(1);
});
