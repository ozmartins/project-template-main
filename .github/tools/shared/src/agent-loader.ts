import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";

export interface AgentFrontmatter {
  name: string;
  description: string;
  model?: string;
  tools?: string[];
  /** Per-agent work-phase budget in minutes. Overrides the factory default. */
  timeout_minutes?: number;
}

export interface AgentPrompt {
  frontmatter: AgentFrontmatter;
  body: string;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

export function loadAgent(agentsDir: string, agentName: string): AgentPrompt {
  const filePath = resolve(agentsDir, `${agentName}.agent.md`);
  const raw = readFileSync(filePath, "utf8");
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    throw new Error(`Agent file ${filePath} is missing YAML frontmatter (--- block)`);
  }
  const frontmatter = yaml.load(match[1]) as AgentFrontmatter;
  if (!frontmatter?.name) {
    throw new Error(`Agent file ${filePath} frontmatter is missing required field: name`);
  }
  const body = match[2].trim();
  return { frontmatter, body };
}

export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{\s*([\w_]+)\s*\}\}/g, (_, key) => {
    const val = vars[key];
    return val !== undefined ? String(val) : `{{ ${key} }}`;
  });
}
