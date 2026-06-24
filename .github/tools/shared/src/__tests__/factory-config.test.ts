import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadFactoryConfig } from "../factory-config.js";

const VALID_CONFIG = `
repository:
  owner: <ORG>
  name: <REPO_NAME>
  default_branch: main
  project_owner: <ORG>
  project_number: null

factory:
  max_open_copilot_prs: 3
  auto_merge_low_risk: false
  active_runner_profile: github-hosted-mvp

commands:
  frontend_lint:
    cmd: "npm --prefix frontend run lint"
    optional: false
  frontend_test:
    cmd: "npm --prefix frontend test -- --run"
    optional: true
`;

describe("loadFactoryConfig", () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = join(tmpdir(), `config-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    configPath = join(dir, "factory.yml");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("parses a valid config", () => {
    writeFileSync(configPath, VALID_CONFIG);
    const config = loadFactoryConfig(configPath);
    expect(config.repository.owner).toBe("<ORG>");
    expect(config.repository.project_owner).toBe("<ORG>");
    expect(config.factory.max_open_copilot_prs).toBe(3);
    expect(config.commands?.["frontend_lint"]?.cmd).toBe("npm --prefix frontend run lint");
    expect(config.commands?.["frontend_test"]?.optional).toBe(true);
  });

  it("applies defaults for missing optional fields", () => {
    writeFileSync(
      configPath,
      `repository:\n  owner: a\n  name: b\nfactory:\n  max_open_copilot_prs: 2\n  auto_merge_low_risk: false\n  active_runner_profile: test\n`
    );
    const config = loadFactoryConfig(configPath);
    expect(config.repository.default_branch).toBe("main");
  });

  it("throws on invalid config", () => {
    writeFileSync(configPath, `not_valid_yaml: {{{`);
    expect(() => loadFactoryConfig(configPath)).toThrow();
  });
});
