import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAgent } from "../agent-loader.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "../../../../../");
const AGENTS_PATH = join(REPO_ROOT, ".github", "agents");
const AGENT_PATH = join(AGENTS_PATH, "pr-handler.agent.md");

describe("pr-handler agent prompt", () => {
  it("loads with the expected metadata and decision-table structure", () => {
    const { frontmatter, body } = loadAgent(AGENTS_PATH, "pr-handler");

    expect(frontmatter.name).toBe("pr-handler");
    expect(frontmatter.tools).toEqual(["gh"]);
    expect(body).toContain("| State | Condition | Action |");
    expect(body).toContain("| draft |");
    expect(body).toContain("| conflicting |");
    expect(body).toContain("| stale |");
    expect(body).toContain("| failing (pr-introduced) |");
    expect(body).toContain("| failing (pre-existing) |");
    expect(body).toContain("| `changes-requested` |");
    expect(body).toContain("| ready |");
    expect(body).toContain("| approved |");
    // CI baseline attribution rows — guards against regression of ADR-0112 / #1033
    expect(body).toContain("| cancelled |");
    expect(body).toContain("| `action_required` |");
  });

  it("mandates get_ci_baseline call before CI nudges (ADR-0112)", () => {
    const { body } = loadAgent(AGENTS_PATH, "pr-handler");
    // The agent must call get_ci_baseline before any CI nudge or request-changes
    expect(body).toContain("get_ci_baseline");
    // Pre-existing main failures must not generate branch-fix nudges
    expect(body).toContain("pre_existing_on_main");
    // action_required gates must route to rerun path, not code-fix
    expect(body).toContain("action_required");
  });

  it("keeps the refactor guardrails compact", () => {
    const content = readFileSync(AGENT_PATH, "utf8");
    const lineCount = content.trimEnd().split(/\r?\n/).length;
    const doNotRekickCount = (content.match(/do not re-kick/gi) ?? []).length;

    expect(lineCount).toBeLessThanOrEqual(110);
    expect(doNotRekickCount).toBe(1);
    expect(content).toContain("## Dependabot stale-base special case");
  });
});
