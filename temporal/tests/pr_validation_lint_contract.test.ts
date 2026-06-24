import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readPrValidationWorkflow() {
  return readFileSync(
    resolve(__dirname, "..", "..", ".github", "workflows", "pr-validation.yml"),
    "utf8"
  );
}

describe("PR validation lint workflow contracts", () => {
  it("defines separate SQL, YAML, and Markdown lint jobs", () => {
    const workflow = readPrValidationWorkflow();

    expect(workflow).toContain("\n  sql-migrations:\n");
    expect(workflow).toContain("\n  yaml-files:\n");
    expect(workflow).toContain("\n  markdown-docs:\n");
  });

  it("makes the summary gate depend on every extra lint job", () => {
    const workflow = readPrValidationWorkflow();
    const summaryNeeds = workflow.match(
      /validation-summary:[\s\S]*?needs:\n([\s\S]*?)\n {4}if: always\(\)/
    );

    expect(summaryNeeds?.[1]).toContain("- sql-migrations");
    expect(summaryNeeds?.[1]).toContain("- yaml-files");
    expect(summaryNeeds?.[1]).toContain("- markdown-docs");
    expect(summaryNeeds?.[1]).toContain("- temporal-dsl");
  });

  it("uses the repo-root lint configs from the workflow", () => {
    const workflow = readPrValidationWorkflow();

    expect(workflow).toContain("sqlfluff lint supabase/migrations --config .sqlfluff");
    expect(workflow).toContain("yamllint -c .yamllint.yml .github/workflows charts");
    expect(workflow).toContain(
      'markdownlint-cli2@0.16.0 --config .markdownlint.yaml "docs/**/*.md" README.md'
    );
  });

  it("runs license allowlist checks for frontend and temporal after npm ci", () => {
    const workflow = readPrValidationWorkflow();
    expect(workflow).toMatch(
      /frontend:[\s\S]*?- name: License compliance check[\s\S]*?run: npm run licenses:check[\s\S]*?working-directory: frontend/
    );
    expect(workflow).toMatch(
      /temporal:[\s\S]*?- name: License compliance check[\s\S]*?run: npm run licenses:check[\s\S]*?working-directory: temporal/
    );
  });

  it("keeps the dedicated Temporal DSL stub job public-PR-safe", () => {
    const workflow = readPrValidationWorkflow();
    const temporalDslJob =
      workflow.match(/\n {2}temporal-dsl:\n([\s\S]*?)\n {2}helm-charts:\n/)?.[1] ?? "";

    expect(temporalDslJob).toContain("npx jest --runTestsByPath");
    expect(temporalDslJob).toContain("tests/interpreter.test.ts");
    expect(temporalDslJob).toContain("tests/expression.test.ts");
    expect(temporalDslJob).toContain("tests/schema.test.ts");
    expect(temporalDslJob).toContain("tests/duration.test.ts");
    expect(temporalDslJob).toContain("tests/llm_agent.test.ts");
    expect(temporalDslJob).toContain("--passWithNoTests");
    expect(temporalDslJob).not.toContain("ANTHROPIC_API_KEY");
    expect(temporalDslJob).not.toContain("OPENAI_API_KEY");
    expect(temporalDslJob).not.toContain("AZURE_OPENAI_API_KEY");
    expect(temporalDslJob).not.toContain("AZURE_API_KEY");
    expect(temporalDslJob).not.toContain("GROQ_API_KEY");
    expect(temporalDslJob).not.toContain("EXA_API_KEY");
    expect(temporalDslJob).not.toContain("COHERE_API_KEY");
  });
});
