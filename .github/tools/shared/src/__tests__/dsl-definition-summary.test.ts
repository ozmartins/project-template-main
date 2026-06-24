import { describe, expect, it } from "vitest";
import {
  listChangedDefinitionFiles,
  renderDslDefinitionChangesComment,
  summariseDefinitionChange,
  type PullRequestFile,
} from "../dsl-definition-summary.js";

const sampleDefinition = JSON.stringify({
  steps: {
    sequence: {
      steps: [
        {
          activity: {
            name: "domain_probe",
            result: "domain_info",
          },
        },
        {
          activity: {
            name: "web_search",
            args: {
              query: "$input.company_name $input.domain",
            },
          },
        },
        {
          condition: {
            if: "$var.domain_info.domain_active == false",
            else: {
              activity: {
                name: "supabase_mutate",
              },
            },
            then: {
              sequence: {
                steps: [
                  {
                    activity: {
                      name: "llm_agent",
                      args: {
                        provider: "anthropic",
                        model_id: "claude-haiku-4-5-20251001",
                      },
                    },
                  },
                  {
                    activity: {
                      name: "llm_agent",
                      args: {
                        provider: "anthropic",
                        model_id: "claude-sonnet-4-6",
                        tools: [{ name: "search_web" }],
                      },
                    },
                  },
                  {
                    activity: {
                      name: "supabase_mutate",
                      args: {
                        table: "company_classifications",
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  },
});

const nonWebSearchDefinition = JSON.stringify({
  steps: {
    sequence: {
      steps: [
        {
          activity: {
            name: "company_crawl",
            args: {
              domain: "$input.domain",
            },
          },
        },
        {
          activity: {
            name: "email_send",
            args: {
              to: "ops@example.com",
            },
          },
        },
      ],
    },
  },
});

describe("dsl-definition-summary", () => {
  it("renders no comment when there are no changed definitions", () => {
    expect(renderDslDefinitionChangesComment([])).toBe("");
  });

  it("filters changed temporal definitions", () => {
    const files: PullRequestFile[] = [
      { filename: "README.md", status: "modified" },
      { filename: "temporal/definitions/vertical-classification.json", status: "modified" },
      {
        filename: "temporal/definitions/new-name.json",
        previous_filename: "temporal/definitions/old-name.json",
        status: "renamed",
      },
    ];

    expect(listChangedDefinitionFiles(files)).toHaveLength(2);
  });

  it("summarises definition content for comment rendering with integration services", () => {
    const summary = summariseDefinitionChange(
      { filename: "temporal/definitions/vertical-classification.json", status: "modified" },
      sampleDefinition
    );
    const comment = renderDslDefinitionChangesComment([summary]);

    expect(summary.llmCalls).toBe(2);
    expect(summary.toolsUsed).toEqual(["search_web"]);
    expect(summary.externalServices).toEqual(["Exa Search", "Supabase"]);
    expect(summary.externalServices).not.toContain("Anthropic");
    expect(summary.steps[0]).toContain("domain_probe");
    expect(comment).toContain("## DSL Definition Changes");
    expect(comment).toContain("**LLM calls:** 2 (1× haiku, 1× sonnet)");
    expect(comment).toContain("**Tools used:** search_web");
    expect(comment).toContain("**External services:** Exa Search, Supabase");
  });

  it("maps non-web_search integration activities to external services", () => {
    const summary = summariseDefinitionChange(
      { filename: "temporal/definitions/company-outreach.json", status: "modified" },
      nonWebSearchDefinition
    );
    const comment = renderDslDefinitionChangesComment([summary]);

    expect(summary.externalServices).toEqual(["Exa Search", "Email Delivery"]);
    expect(comment).toContain("**External services:** Exa Search, Email Delivery");
  });

  it("handles removed definitions without file contents", () => {
    const summary = summariseDefinitionChange(
      { filename: "temporal/definitions/legacy.json", status: "removed" },
      undefined
    );
    expect(summary.steps[0]).toContain("unavailable");
    expect(summary.llmCalls).toBe(0);
  });

  it("handles invalid JSON definitions", () => {
    const summary = summariseDefinitionChange(
      { filename: "temporal/definitions/broken.json", status: "modified" },
      "{not-json"
    );
    expect(summary.steps[0]).toContain("Failed to parse definition JSON");
    expect(summary.llmCalls).toBe(0);
  });

  it("collects activity steps within for_each body", () => {
    const definition = JSON.stringify({
      steps: {
        for_each: {
          items: "$var.companies",
          item_var: "company",
          body: {
            activity: {
              name: "llm_agent",
              args: {
                provider: "anthropic",
                model_id: "claude-haiku-4-5-20251001",
              },
            },
          },
        },
      },
    });
    const summary = summariseDefinitionChange(
      { filename: "temporal/definitions/loop.json", status: "added" },
      definition
    );
    expect(summary.steps[0]).toContain("for_each");
    expect(summary.steps[0]).toContain("$var.companies");
    expect(summary.steps[1]).toContain("llm_agent");
    expect(summary.llmCalls).toBe(1);
  });

  it("collects activity steps within try_catch try, catch body, and finally", () => {
    const definition = JSON.stringify({
      steps: {
        try_catch: {
          try: {
            activity: { name: "web_search", args: { query: "test" } },
          },
          catch: {
            error_var: "err",
            body: {
              activity: { name: "supabase_mutate", args: { table: "errors" } },
            },
          },
          finally: {
            activity: { name: "domain_probe", result: "probe" },
          },
        },
      },
    });
    const summary = summariseDefinitionChange(
      { filename: "temporal/definitions/resilient.json", status: "added" },
      definition
    );
    expect(summary.steps[0]).toBe("`try_catch`");
    expect(summary.steps[1]).toContain("web_search");
    expect(summary.steps[2]).toContain("supabase_mutate");
    expect(summary.steps[3]).toContain("domain_probe");
    expect(summary.externalServices).toContain("Supabase");
  });
});
