import * as fs from "node:fs";
import * as path from "node:path";
import { validateDefinition } from "../src/workflows/dsl/schema";

type JsonRecord = Record<string, unknown>;

function loadDefinition(): JsonRecord {
  const definitionPath = path.resolve(__dirname, "../definitions/content-moderation.json");
  return JSON.parse(fs.readFileSync(definitionPath, "utf8")) as JsonRecord;
}

function findStep(step: unknown, predicate: (step: JsonRecord) => boolean): JsonRecord | null {
  if (!step || typeof step !== "object" || Array.isArray(step)) return null;
  const record = step as JsonRecord;
  if (predicate(record)) return record;

  if (record.sequence && typeof record.sequence === "object") {
    for (const child of (record.sequence as JsonRecord).steps as unknown[]) {
      const match = findStep(child, predicate);
      if (match) return match;
    }
  }

  if (record.parallel && typeof record.parallel === "object") {
    for (const child of (record.parallel as JsonRecord).branches as unknown[]) {
      const match = findStep(child, predicate);
      if (match) return match;
    }
  }

  if (record.condition && typeof record.condition === "object") {
    const condition = record.condition as JsonRecord;
    const thenMatch = findStep(condition.then, predicate);
    if (thenMatch) return thenMatch;
    const elseMatch = findStep(condition.else, predicate);
    if (elseMatch) return elseMatch;
  }

  if (record.wait_signal && typeof record.wait_signal === "object") {
    const waitSignal = record.wait_signal as JsonRecord;
    const timeoutMatch = findStep(waitSignal.on_timeout, predicate);
    if (timeoutMatch) return timeoutMatch;
  }

  return null;
}

describe("content-moderation definition", () => {
  it("passes DSL structural validation", () => {
    const definition = loadDefinition();
    expect(() => validateDefinition(definition)).not.toThrow();
  });

  it("requires policy_version plus either content_text or content_url", () => {
    const definition = loadDefinition();
    const schema = definition.input_schema as JsonRecord;

    expect(schema.required).toEqual(["policy_version"]);
    expect(schema.anyOf).toEqual([{ required: ["content_text"] }, { required: ["content_url"] }]);
  });

  it("uses explicit review signal and persists the current content_submission version", () => {
    const definition = loadDefinition();

    const waitSignalStep = findStep(definition.steps, (step) => {
      const waitSignal = step.wait_signal as JsonRecord | undefined;
      return waitSignal?.signal === "review_decision";
    });
    expect(waitSignalStep).not.toBeNull();

    const crawlStep = findStep(definition.steps, (step) => {
      const activity = step.activity as JsonRecord | undefined;
      return activity?.name === "web_crawl";
    });
    expect(crawlStep).not.toBeNull();
    expect(((crawlStep as JsonRecord).activity as JsonRecord).args).toMatchObject({
      max_chars: "$var.crawl_max_chars",
    });

    const mutateStep = findStep(definition.steps, (step) => {
      const activity = step.activity as JsonRecord | undefined;
      return activity?.name === "supabase_mutate";
    });
    expect(mutateStep).not.toBeNull();

    const mutateArgs = ((mutateStep as JsonRecord).activity as JsonRecord).args as JsonRecord;
    expect(mutateArgs).toMatchObject({
      operation: "upsert",
      entity_type: "content_submission",
      source_record_id: "$input.submission_id",
    });

    const data = mutateArgs.data as JsonRecord;
    expect(data.decision_status).toBe("$var.decision_status");
    expect(data.policy_version).toBe("$input.policy_version");
    expect((data.review as JsonRecord).reviewer_id).toBe("$var.review_payload.reviewer_id");
  });
});
