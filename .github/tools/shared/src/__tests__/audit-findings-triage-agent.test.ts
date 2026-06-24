import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAgent } from "../agent-loader.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "../../../../../");
const AGENTS_PATH = join(REPO_ROOT, ".github", "agents");
const AGENT_PATH = join(AGENTS_PATH, "audit-findings-triage.agent.md");

describe("audit-findings-triage agent prompt contract", () => {
  it("loads with expected metadata and tools", () => {
    const { frontmatter } = loadAgent(AGENTS_PATH, "audit-findings-triage");

    expect(frontmatter.name).toBe("audit-findings-triage");
    expect(frontmatter.tools).toContain("gh");
  });

  it("requires AUDIT_JSON_PATH preflight: exits without filing when audit artifact is missing", () => {
    const prompt = readFileSync(AGENT_PATH, "utf8");

    // Preflight guard must reference AUDIT_JSON_PATH existence check
    expect(prompt).toContain("AUDIT_JSON_PATH");
    expect(prompt).toMatch(/missing|does not point to a file/i);
    // Must mandate exiting without creating issues on preflight failure
    expect(prompt).toMatch(/exit without creating issues|exit without filing/i);
  });

  it("keeps the fingerprint-based deduplication step with open-issue lookup", () => {
    const prompt = readFileSync(AGENT_PATH, "utf8");

    // Fingerprint construction format must be preserved
    expect(prompt).toContain("audit-finding-");
    // Must search open issues for the fingerprint
    expect(prompt).toMatch(/Search open.*queue:security.*fingerprint|open.*fingerprint.*body/i);
    // Must log "already tracked" when an open match is found
    expect(prompt).toContain("already tracked");
  });

  it("keeps the closed-issue reopen path in the dedup section", () => {
    const prompt = readFileSync(AGENT_PATH, "utf8");

    // Closed-issue reopen with recurrence comment must be present
    expect(prompt).toMatch(/closed issue.*reopen|reopen.*closed/i);
    expect(prompt).toMatch(/recur|finding recurred/i);
  });

  it("keeps the broader title-similarity guard in the dedup section", () => {
    const prompt = readFileSync(AGENT_PATH, "utf8");

    // Title-keyword / similarity check must be mentioned as a fallback after fingerprint
    expect(prompt).toMatch(/title.{0,60}(keyword|overlap|similarity|check)/i);
    // Must log/skip when title match indicates the same issue
    expect(prompt).toMatch(/skip.*log.*existing|log.*existing.*issue/i);
  });

  it("preserves canonical issue body sections: Summary, Root Cause, Acceptance Criteria, Out of Scope", () => {
    const prompt = readFileSync(AGENT_PATH, "utf8");

    expect(prompt).toContain("## Summary");
    expect(prompt).toContain("## Root Cause");
    expect(prompt).toContain("## Acceptance Criteria");
    expect(prompt).toContain("## Out of Scope");
  });

  it("preserves queue/priority labeling in the issue-creation contract", () => {
    const prompt = readFileSync(AGENT_PATH, "utf8");

    // Required labels on every filed issue
    expect(prompt).toContain("queue:security");
    expect(prompt).toContain("priority:");
    expect(prompt).toContain("needs-platform-review");
  });

  it("preserves the fingerprint HTML comment marker in the issue body template", () => {
    const prompt = readFileSync(AGENT_PATH, "utf8");

    // The marker anchors deduplication; it must still be in the body template
    expect(prompt).toMatch(/<!--\s*fingerprint:audit-finding-/);
  });

  it("preserves the What to Build section in the canonical issue body template", () => {
    const prompt = readFileSync(AGENT_PATH, "utf8");

    // Required remediation section must remain in the body template
    expect(prompt).toContain("## What to Build");
  });

  it("documents AUDIT_SOURCE as a required input with all three supported sources", () => {
    const prompt = readFileSync(AGENT_PATH, "utf8");

    // AUDIT_SOURCE controls which parser branch runs; all three sources must remain documented
    expect(prompt).toContain("AUDIT_SOURCE");
    expect(prompt).toContain("kube-bench");
    expect(prompt).toContain("azure-prowler");
    expect(prompt).toContain("azure-defender");
  });

  it("keeps the per-run issue-filing cap guardrail", () => {
    const prompt = readFileSync(AGENT_PATH, "utf8");

    // Cap prevents runaway issue creation; must stay in Guardrails
    expect(prompt).toMatch(/at most 10 new issues per run/i);
  });
});
