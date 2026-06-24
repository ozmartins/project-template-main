import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readPackageJson() {
  return JSON.parse(readFileSync(resolve(__dirname, "..", "package.json"), "utf8")) as {
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
  };
}

function readDockerfile() {
  return readFileSync(resolve(__dirname, "..", "Dockerfile"), "utf8");
}

describe("Temporal worker packaging contracts", () => {
  it("keeps Temporal validation tooling in devDependencies", () => {
    const packageJson = readPackageJson();

    expect(packageJson.scripts).toEqual(
      expect.objectContaining({
        lint: expect.stringContaining("biome"),
        typecheck: expect.stringContaining("tsc"),
        test: expect.stringContaining("jest"),
      })
    );
    expect(packageJson.devDependencies).toEqual(
      expect.objectContaining({
        "@biomejs/biome": expect.any(String),
        "@temporalio/testing": expect.any(String),
        "@types/jest": expect.any(String),
        jest: expect.any(String),
        "ts-jest": expect.any(String),
        typescript: expect.any(String),
      })
    );
  });

  it("builds from the checked-in Node manifests instead of removed Python packaging files", () => {
    const dockerfile = readDockerfile();

    expect(dockerfile).toContain("COPY package.json package-lock.json ./");
    expect(dockerfile).toContain("RUN npm ci --include=dev");
    expect(dockerfile).toContain("COPY package*.json ./");
    expect(dockerfile).toContain("RUN npm ci --omit=dev && rm package-lock.json");
    expect(dockerfile).not.toContain("requirements.txt");
    expect(dockerfile).not.toContain("pyproject.toml");
    expect(dockerfile).not.toContain("pip install");
  });
});
