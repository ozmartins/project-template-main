import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAgent } from "../agent-loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..", "..", "..", "..");
const agentsPath = join(repoRoot, ".github", "agents");

describe("docs-improver agent prompt", () => {
  it("loads with expected metadata and guardrails", () => {
    const { frontmatter, body } = loadAgent(agentsPath, "docs-improver");
    expect(frontmatter.name).toBe("docs-improver");
    expect(frontmatter.tools).toEqual(["gh"]);
    expect(body).toContain("create/update issues, not direct doc edits");
    expect(body).toContain("no changes needed");
    expect(body).toContain("No AKS/`az`/`kubectl` assumptions");
  });

  it("stays within the agent character budget", () => {
    const agentPath = join(agentsPath, "docs-improver.agent.md");
    const content = readFileSync(agentPath, "utf8");
    expect(content.length).toBeLessThan(6000);
  });
});
