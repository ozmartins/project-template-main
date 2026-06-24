/**
 * CI test suite for the content-moderation DSL definition and smoke script.
 *
 * Does NOT require a running Temporal server, LLM keys, or Supabase — all
 * expensive I/O paths are covered by the manual smoke script.
 *
 * Coverage:
 *  1. DSL schema validation passes for content-moderation.json.
 *  2. Input schema shape is correct.
 *  3. The wait_signal / review_decision gate is present in the definition.
 *  4. The live definition persists through the content_submission entity /
 *     entity_versions contract, while patchDefinitionForSmoke rewrites smoke
 *     writes to the workflow_classifications table.
 *  5. Routing condition expressions evaluate correctly for all three fixtures
 *     using the expression evaluator directly (no Temporal runtime needed).
 */

import definition from "../definitions/content-moderation.json";
import { patchDefinitionForSmoke } from "../scripts/test-content-moderation";
import { evaluateCondition } from "../src/workflows/dsl/expression";
import { validateDefinition } from "../src/workflows/dsl/schema";

// Index of the human-review confidence gate in the top-level workflow sequence.
const HUMAN_REVIEW_CONDITION_INDEX = 3;
// Index of the wait_signal step inside the human-review branch sequence.
const WAIT_SIGNAL_STEP_INDEX = 1;
// Index of the final persistence activity in the top-level workflow sequence.
const PERSIST_STEP_INDEX = 4;

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }

  return value as Record<string, unknown>;
}

function requireSteps(value: unknown, label: string): Array<Record<string, unknown>> {
  const sequence = requireRecord(requireRecord(value, label).sequence, `${label}.sequence`);
  const steps = sequence.steps;

  if (!Array.isArray(steps)) {
    throw new Error(`${label}.sequence.steps must be an array`);
  }

  return steps as Array<Record<string, unknown>>;
}

function getTopLevelSteps(
  sourceDefinition: Record<string, unknown> = definition as unknown as Record<string, unknown>
): Array<Record<string, unknown>> {
  return requireSteps(sourceDefinition.steps, "definition.steps");
}

function getWaitSignalStep(): { wait_signal: Record<string, unknown> } {
  const humanReviewCondition = requireRecord(
    requireRecord(
      getTopLevelSteps()[HUMAN_REVIEW_CONDITION_INDEX],
      `top-level step ${HUMAN_REVIEW_CONDITION_INDEX}`
    ).condition,
    `top-level step ${HUMAN_REVIEW_CONDITION_INDEX}.condition`
  );
  const humanReviewSteps = requireSteps(
    humanReviewCondition.then,
    `top-level step ${HUMAN_REVIEW_CONDITION_INDEX}.condition.then`
  );
  const waitSignalStep = requireRecord(
    humanReviewSteps[WAIT_SIGNAL_STEP_INDEX],
    `human review step ${WAIT_SIGNAL_STEP_INDEX}`
  );

  return {
    wait_signal: requireRecord(
      waitSignalStep.wait_signal,
      `human review step ${WAIT_SIGNAL_STEP_INDEX}.wait_signal`
    ),
  };
}

function getPersistArgs(
  sourceDefinition: Record<string, unknown> = definition as unknown as Record<string, unknown>
): Record<string, unknown> {
  const persistStep = requireRecord(
    getTopLevelSteps(sourceDefinition)[PERSIST_STEP_INDEX],
    `top-level step ${PERSIST_STEP_INDEX}`
  );
  const activity = requireRecord(
    persistStep.activity,
    `top-level step ${PERSIST_STEP_INDEX}.activity`
  );

  return requireRecord(activity.args, `top-level step ${PERSIST_STEP_INDEX}.activity.args`);
}

// ── 1. DSL schema validation ───────────────────────────────────────────────

describe("content-moderation definition — schema validation", () => {
  it("passes validateDefinition without throwing", () => {
    expect(() =>
      validateDefinition(definition as unknown as Record<string, unknown>)
    ).not.toThrow();
  });

  it("has name and semver version", () => {
    expect(definition.name).toBe("content-moderation");
    expect(definition.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

// ── 2. Input schema ────────────────────────────────────────────────────────

describe("content-moderation definition — input_schema", () => {
  const schema = definition.input_schema as {
    type: string;
    required: string[];
    properties: Record<string, unknown>;
  };

  it("is type=object", () => {
    expect(schema.type).toBe("object");
  });

  it("requires policy_version", () => {
    expect(schema.required).toContain("policy_version");
  });

  it("has content_text property", () => {
    expect(schema.properties).toHaveProperty("content_text");
  });

  it("has content_url property", () => {
    expect(schema.properties).toHaveProperty("content_url");
  });

  it("has submission_id property", () => {
    expect(schema.properties).toHaveProperty("submission_id");
  });

  it("has submitted_by property", () => {
    expect(schema.properties).toHaveProperty("submitted_by");
  });
});

// ── 3. Definition structure — wait_signal gate ────────────────────────────

describe("content-moderation definition — structure", () => {
  const json = JSON.stringify(definition);
  const waitSignal = getWaitSignalStep().wait_signal;
  const persistArgs = getPersistArgs();
  const persistData = requireRecord(persistArgs.data, "persist args data");
  const reviewData = requireRecord(persistData.review, "persist args data.review");
  const moderationData = requireRecord(persistData.moderation, "persist args data.moderation");

  it("contains a wait_signal step keyed review_decision", () => {
    expect(json).toContain('"wait_signal"');
    expect(waitSignal.signal).toBe("review_decision");
  });

  it("wait_signal captures result in review_signal variable", () => {
    expect(waitSignal.result).toBe("review_signal");
  });

  it("wait_signal has a timeout", () => {
    expect(waitSignal.timeout).toBe("72h");
  });

  it("contains on_timeout handler", () => {
    expect(json).toContain('"on_timeout"');
  });

  it("contains an llm_agent classification step", () => {
    expect(json).toContain('"llm_agent"');
  });

  it("contains a web_crawl step for URL inputs", () => {
    expect(json).toContain('"web_crawl"');
  });

  it("contains supabase_mutate for persistence", () => {
    expect(json).toContain('"supabase_mutate"');
  });

  it("persists the latest content_submission state through the entity contract", () => {
    expect(persistArgs).toMatchObject({
      operation: "upsert",
      entity_type: "content_submission",
      source_record_id: "$input.submission_id",
      created_by: "$input.submitted_by",
    });
    expect(persistData.decision_status).toBe("$var.decision_status");
    expect(persistData.policy_version).toBe("$input.policy_version");
    expect(moderationData.confidence).toBe("$var.classification.confidence");
    expect(reviewData.reviewer_id).toBe("$var.review_payload.reviewer_id");
  });

  it("decision_status variable is initialised in variables", () => {
    const vars = definition.variables as Record<string, unknown>;
    expect(vars).toHaveProperty("decision_status");
  });
});

// ── 4. patchDefinitionForSmoke ─────────────────────────────────────────────

describe("content-moderation patchDefinitionForSmoke", () => {
  const patched = patchDefinitionForSmoke(
    definition as unknown as Record<string, unknown>,
    "openai",
    "gpt-4o"
  );
  const patchedJson = JSON.stringify(patched);

  it("injects provider into llm_agent args", () => {
    expect(patchedJson).toContain('"provider":"openai"');
  });

  it("injects model_id into llm_agent args", () => {
    expect(patchedJson).toContain('"model_id":"gpt-4o"');
  });

  it("converts entity_type writes to workflow_classifications table", () => {
    expect(patchedJson).toContain('"workflow_classifications"');
    expect(patchedJson).not.toContain('"content_submission"');
  });

  it("sets operation to upsert for idempotent smoke runs", () => {
    expect(patchedJson).toContain('"upsert"');
  });

  it("maps confidence to the confidence column", () => {
    expect(patchedJson).toContain('"$var.classification.confidence"');
  });

  it("maps decision_status to the vertical column", () => {
    expect(patchedJson).toContain('"$var.decision_status"');
  });

  it("rewrites entity persistence to workflow_classifications for smoke runs", () => {
    const patchedArgs = getPersistArgs(patched);
    expect(patchedArgs).toMatchObject({
      operation: "upsert",
      table: "workflow_classifications",
      match: { domain: "$input.submission_id" },
    });
    expect(patchedArgs.entity_type).toBeUndefined();
    expect(patchedArgs.source_record_id).toBeUndefined();
    expect(patchedArgs.data).toBeUndefined();
  });

  it("does not mutate the original definition", () => {
    const originalJson = JSON.stringify(definition);
    expect(originalJson).toContain('"content_submission"');
    expect(originalJson).not.toContain('"workflow_classifications"');
  });
});

// ── 5. Routing condition expressions ──────────────────────────────────────

describe("content-moderation routing — confidence threshold", () => {
  const CONFIDENCE_EXPR = "$var.classification.confidence < 0.7";

  it("safe fixture (confidence=0.95) does NOT require human review", () => {
    const vars = { classification: { confidence: 0.95 } };
    expect(evaluateCondition(CONFIDENCE_EXPR, vars, {})).toBe(false);
  });

  it("violating fixture (confidence=0.92) does NOT require human review", () => {
    const vars = { classification: { confidence: 0.92 } };
    expect(evaluateCondition(CONFIDENCE_EXPR, vars, {})).toBe(false);
  });

  it("borderline fixture (confidence=0.55) requires human review", () => {
    const vars = { classification: { confidence: 0.55 } };
    expect(evaluateCondition(CONFIDENCE_EXPR, vars, {})).toBe(true);
  });

  it("confidence exactly at threshold (0.7) does NOT require human review", () => {
    const vars = { classification: { confidence: 0.7 } };
    expect(evaluateCondition(CONFIDENCE_EXPR, vars, {})).toBe(false);
  });

  it("undefined confidence (stub) does NOT require human review", () => {
    const vars = { classification: {} };
    // undefined < 0.7 → NaN comparison → false, so validation never blocks on wait_signal
    expect(evaluateCondition(CONFIDENCE_EXPR, vars, {})).toBe(false);
  });
});

describe("content-moderation routing — auto-reject condition", () => {
  // Read the reject condition directly from the definition so that a regression
  // in the definition itself (e.g. adding "and severity == 'high'") causes CI to fail.
  //
  // Step layout in steps.sequence.steps:
  //   0 — conditional crawl
  //   1 — llm_agent classification
  //   2 — set_variable classification
  //   3 — confidence-gate condition  ← else branch holds the auto-routing condition
  const CONFIDENCE_GATE_STEP_INDEX = 3;
  const sequenceSteps = (
    definition.steps as unknown as {
      sequence: { steps: { condition?: { else?: { condition?: { if?: string } } } }[] };
    }
  ).sequence.steps;
  const REJECT_EXPR: string =
    sequenceSteps[CONFIDENCE_GATE_STEP_INDEX]?.condition?.else?.condition?.if ?? "";

  it("definition exposes the reject expression at the expected path", () => {
    // Guards against structural changes (renamed keys, shifted step order, etc.)
    // that would cause REJECT_EXPR to silently resolve to "" and make all tests vacuously pass.
    expect(REJECT_EXPR).toBeTruthy();
  });

  it("reject expression is safe==false (not gated on severity)", () => {
    // This assertion would fail if the definition were reverted to the old
    // 'safe == false and severity == "high"' expression.
    expect(REJECT_EXPR).toBe("$var.classification.safe == false");
  });

  it("safe=true does NOT auto-reject", () => {
    const vars = { classification: { safe: true, severity: "high" } };
    expect(evaluateCondition(REJECT_EXPR, vars, {})).toBe(false);
  });

  it("safe=false, severity=high DOES auto-reject", () => {
    const vars = { classification: { safe: false, severity: "high" } };
    expect(evaluateCondition(REJECT_EXPR, vars, {})).toBe(true);
  });

  it("safe=false, severity=medium DOES auto-reject (policy-violating content must not be approved)", () => {
    const vars = { classification: { safe: false, severity: "medium" } };
    expect(evaluateCondition(REJECT_EXPR, vars, {})).toBe(true);
  });

  it("safe=false, severity=low DOES auto-reject (policy-violating content must not be approved)", () => {
    const vars = { classification: { safe: false, severity: "low" } };
    expect(evaluateCondition(REJECT_EXPR, vars, {})).toBe(true);
  });

  it("undefined values (stub) do NOT auto-reject", () => {
    const vars = { classification: {} };
    expect(evaluateCondition(REJECT_EXPR, vars, {})).toBe(false);
  });
});

describe("content-moderation routing — signal decision", () => {
  const APPROVE_EXPR = "$var.review_signal != null and $var.review_signal.decision == 'approve'";

  it("approve signal sets decision to approved", () => {
    const vars = { review_signal: { decision: "approve", reviewer_id: "rev-1" } };
    expect(evaluateCondition(APPROVE_EXPR, vars, {})).toBe(true);
  });

  it("reject signal does NOT satisfy approve condition", () => {
    const vars = { review_signal: { decision: "reject", reviewer_id: "rev-1" } };
    expect(evaluateCondition(APPROVE_EXPR, vars, {})).toBe(false);
  });

  it("null signal (timeout) results in reject branch", () => {
    const vars = { review_signal: null };
    expect(evaluateCondition(APPROVE_EXPR, vars, {})).toBe(false);
  });

  it("unset review_signal (undefined) results in reject branch", () => {
    const vars: Record<string, unknown> = {};
    expect(evaluateCondition(APPROVE_EXPR, vars, {})).toBe(false);
  });

  it("approve signal with note field is still valid", () => {
    const vars = {
      review_signal: { decision: "approve", reviewer_id: "rev-2", note: "Looks ok" },
    };
    expect(evaluateCondition(APPROVE_EXPR, vars, {})).toBe(true);
  });
});

describe("content-moderation routing — final decision_status persist condition", () => {
  const REJECTED_EXPR = "$var.decision_status == 'rejected'";

  it("rejected decision_status routes to flag branch", () => {
    const vars = { decision_status: "rejected" };
    expect(evaluateCondition(REJECTED_EXPR, vars, {})).toBe(true);
  });

  it("approved decision_status routes to approve branch", () => {
    const vars = { decision_status: "approved" };
    expect(evaluateCondition(REJECTED_EXPR, vars, {})).toBe(false);
  });

  it("pending_human_review (mid-flight) does not match rejected", () => {
    const vars = { decision_status: "pending_human_review" };
    expect(evaluateCondition(REJECTED_EXPR, vars, {})).toBe(false);
  });
});
