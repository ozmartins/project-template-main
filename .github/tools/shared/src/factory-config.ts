import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { z } from "zod";

const CommandSchema = z.object({
  cmd: z.string(),
  optional: z.boolean().default(false),
});

const FactoryConfigSchema = z.object({
  repository: z.object({
    owner: z.string(),
    name: z.string(),
    default_branch: z.string().default("main"),
    project_owner: z.string().optional(),
    project_number: z.number().nullable().optional(),
  }),
  factory: z.object({
    max_open_copilot_prs: z.number().default(3),
    auto_merge_low_risk: z.boolean().default(false),
    active_runner_profile: z.string().default("github-hosted-mvp"),
    // Default per-agent work-phase budget (minutes). Agents may override via
    // `timeout_minutes` in their frontmatter (e.g. heavy reviewers/architects).
    agent_timeout_minutes: z.number().default(10),
  }),
  runners: z
    .object({
      default_agent: z.string().default("ubuntu-latest"),
      github_hosted: z.string().default("ubuntu-latest"),
    })
    .optional(),
  stack: z
    .object({
      frontend: z.string().optional(),
      worker: z.string().optional(),
      database: z.string().optional(),
      deployment: z.string().optional(),
      deployment_profiles: z.array(z.string()).optional(),
    })
    .optional(),
  commands: z.record(CommandSchema).optional(),
});

export type FactoryConfig = z.infer<typeof FactoryConfigSchema>;

export function loadFactoryConfig(configPath: string): FactoryConfig {
  const raw = readFileSync(resolve(configPath), "utf8");
  const parsed = yaml.load(raw);
  return FactoryConfigSchema.parse(parsed);
}
