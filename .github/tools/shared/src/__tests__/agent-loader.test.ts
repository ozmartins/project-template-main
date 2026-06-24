import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadAgent, interpolate } from "../agent-loader.js";

describe("loadAgent", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `agent-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("parses frontmatter and body", () => {
    writeFileSync(
      join(dir, "test-agent.agent.md"),
      `---\nname: test-agent\ndescription: A test agent\nmodel: gpt-4.1\n---\n\nYou are a test agent.\n`
    );
    const { frontmatter, body } = loadAgent(dir, "test-agent");
    expect(frontmatter.name).toBe("test-agent");
    expect(frontmatter.model).toBe("gpt-4.1");
    expect(body).toBe("You are a test agent.");
  });

  it("throws if frontmatter is missing", () => {
    writeFileSync(join(dir, "bad.agent.md"), `No frontmatter here`);
    expect(() => loadAgent(dir, "bad")).toThrow("missing YAML frontmatter");
  });

  it("throws if name is missing", () => {
    writeFileSync(
      join(dir, "noname.agent.md"),
      `---\ndescription: missing name\n---\n\nBody.\n`
    );
    expect(() => loadAgent(dir, "noname")).toThrow("missing required field: name");
  });
});

describe("interpolate", () => {
  it("replaces variables", () => {
    expect(interpolate("Hello {{ owner }}/{{ repo }}", { owner: "acme", repo: "app" })).toBe(
      "Hello acme/app"
    );
  });

  it("leaves unknown variables untouched", () => {
    expect(interpolate("Value: {{ unknown }}", {})).toBe("Value: {{ unknown }}");
  });

  it("handles numeric values", () => {
    expect(interpolate("Max: {{ max }}", { max: 3 })).toBe("Max: 3");
  });
});
