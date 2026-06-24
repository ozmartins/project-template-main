/**
 * Regression coverage for PR #322: factory capacity / planning limits.
 *
 * Asserts:
 *  1. `.github/factory.yml` carries `max_open_copilot_prs: 8` (raised from 3).
 *  2. The Zod schema in `factory-config.ts` round-trips a value of 8 without
 *     capping or rejecting it (no silent revert to an old default).
 *  3. `buildTemplateVars` forwards `max_open_copilot_prs` from config to agent
 *     templates so the PM agent always operates on the live limit.
 *  4. `project-manager.agent.md` uses the `{{ max_open_copilot_prs }}` template
 *     variable for its throttle check — not a hard-coded numeric literal.
 *  5. `tech-reviewer.agent.md` honours the raised reviewer cap of 10 PRs per run
 *     (was 5) and explicitly links it to the fuller pipeline.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { loadFactoryConfig } from "../factory-config.js";
import { buildTemplateVars } from "../run-agent.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "../../../../../");

const FACTORY_CONFIG_PATH = join(REPO_ROOT, ".github/factory.yml");
const PM_AGENT_PATH = join(REPO_ROOT, ".github/agents/project-manager.agent.md");
const TECH_REVIEWER_AGENT_PATH = join(REPO_ROOT, ".github/agents/tech-reviewer.agent.md");

// ─── 1. factory.yml carries the new limit ────────────────────────────────────

describe("factory.yml capacity limits (PR #322)", () => {
  it("has max_open_copilot_prs set to 8 (not the old 3)", () => {
    const raw = yaml.load(readFileSync(FACTORY_CONFIG_PATH, "utf8")) as Record<string, unknown>;
    const factory = raw["factory"] as Record<string, unknown>;
    expect(factory["max_open_copilot_prs"]).toBe(8);
  });
});

// ─── 2. Schema round-trips a value of 8 without capping ──────────────────────

describe("FactoryConfig schema accepts raised max_open_copilot_prs", () => {
  it("parses max_open_copilot_prs: 8 without reverting to an old default", () => {
    const config = loadFactoryConfig(FACTORY_CONFIG_PATH);
    expect(config.factory.max_open_copilot_prs).toBe(8);
    // Guard: schema must not silently cap the value at the old limit of 3.
    expect(config.factory.max_open_copilot_prs).toBeGreaterThan(3);
  });

  it("schema does not reject values higher than the previous cap of 3", () => {
    // Verify the schema is agnostic about the numeric value by checking that
    // loadFactoryConfig successfully returns the real file's value of 8.
    let config: ReturnType<typeof loadFactoryConfig> | undefined;
    expect(() => {
      config = loadFactoryConfig(FACTORY_CONFIG_PATH);
    }).not.toThrow();
    expect(config!.factory.max_open_copilot_prs).toBeGreaterThanOrEqual(8);
  });
});

// ─── 3. buildTemplateVars forwards the live config value ─────────────────────

describe("buildTemplateVars propagates max_open_copilot_prs from factory config", () => {
  it("passes max_open_copilot_prs: 8 to agent templates when loaded from real factory.yml", () => {
    const config = loadFactoryConfig(FACTORY_CONFIG_PATH);
    const vars = buildTemplateVars(
      {
        owner: "<ORG>",
        repo: "<REPO_NAME>",
        runUrl: "https://github.com/<ORG>/<REPO_NAME>/actions/runs/1",
      },
      config
    );
    expect(vars["max_open_copilot_prs"]).toBe(8);
  });

  it("does not silently retain the old hard-coded value of 3", () => {
    const config = loadFactoryConfig(FACTORY_CONFIG_PATH);
    const vars = buildTemplateVars(
      {
        owner: "<ORG>",
        repo: "<REPO_NAME>",
        runUrl: "https://github.com/<ORG>/<REPO_NAME>/actions/runs/1",
      },
      config
    );
    expect(vars["max_open_copilot_prs"]).not.toBe(3);
  });
});

// ─── 4. project-manager agent uses the template variable ─────────────────────

describe("project-manager agent throttle check", () => {
  const pmBody = readFileSync(PM_AGENT_PATH, "utf8");

  it("uses {{ max_open_copilot_prs }} template variable for the open-PR throttle check", () => {
    // The PM must read the limit from config, not a literal number hard-coded in the prompt.
    expect(pmBody).toContain("{{ max_open_copilot_prs }}");
  });

  it("does not hard-code the old limit of 3 as a PR throttle threshold", () => {
    // The guard condition lines contain '{{ max_open_copilot_prs }}'; they must
    // not embed a bare `3` as the effective cap (which would ignore the config).
    // Only lines that form a conditional throttle check (containing `>=`) are considered.
    const throttleLines = pmBody
      .split("\n")
      .filter((line) => line.includes("max_open_copilot_prs") && line.includes(">="));
    expect(throttleLines.length).toBeGreaterThan(0);
    // Every throttle-condition line must reference the template variable, not a literal 3.
    throttleLines.forEach((line) => {
      expect(line).toContain("{{ max_open_copilot_prs }}");
    });
  });
});

// ─── 5. tech-reviewer agent honours the new reviewer cap of 10 ───────────────

describe("tech-reviewer agent reviewer cap (PR #322)", () => {
  const reviewerBody = readFileSync(TECH_REVIEWER_AGENT_PATH, "utf8");
  /** Matches an active reviewer throughput cap directive, e.g. "Review at most 10 PRs per run". */
  const REVIEW_CAP_PATTERN = /review at most (\d+) prs per run/i;

  it("caps review throughput at 10 PRs per run (raised from 5)", () => {
    // The exact guardrail line added in PR #322.
    expect(reviewerBody).toContain("Review at most 10 PRs per run");
  });

  it("does not instruct the reviewer to stop at the old cap of 5 PRs per run", () => {
    // Ensure the old '5 PRs per run' limit is not present as a standalone
    // cap directive (the historical context mention is fine, but no active cap).
    const lines = reviewerBody.split("\n");
    const activeCaps = lines.filter(
      (line) =>
        REVIEW_CAP_PATTERN.test(line) &&
        !line.trim().startsWith("//") &&
        !line.trim().startsWith("#")
    );
    expect(activeCaps.length).toBeGreaterThan(0);
    activeCaps.forEach((line) => {
      const match = line.match(REVIEW_CAP_PATTERN);
      if (!match) throw new Error(`Line matched REVIEW_CAP_PATTERN filter but re-match failed: ${line}`);
      expect(Number(match[1])).toBeGreaterThan(5);
    });
  });

  it("links the raised reviewer cap to the fuller pipeline (max_open_copilot_prs is 8)", () => {
    // The guardrail must explicitly document why the cap was raised to 10 so
    // future readers understand the coupling between PM capacity and reviewer throughput.
    expect(reviewerBody).toContain("max_open_copilot_prs is 8");
  });
});
