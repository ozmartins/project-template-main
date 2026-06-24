import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "../fingerprint-cli.ts");
const TSX = resolve(__dirname, "../../node_modules/.bin/tsx");

function runCli(args: string[]): { stdout: string; exitCode: number } {
  const result = spawnSync(TSX, [CLI, ...args], { encoding: "utf8" });
  return { stdout: result.stdout?.trim() ?? "", exitCode: result.status ?? 1 };
}

function extractLine(stdout: string, prefix: string): string | null {
  const line = stdout.split("\n").find((l) => l.startsWith(prefix));
  return line ? line.slice(prefix.length) : null;
}

// ---------------------------------------------------------------------------
// CLI-level regression: normalization must be applied by the CLI itself.
// These tests fail if the `parts.map(normalizeFingerprintPart)` line is
// removed from fingerprint-cli.ts, because raw "bootstrap/secret" and
// "bootstrap-secret" hash to different values without normalization.
// ---------------------------------------------------------------------------

describe("fingerprint-cli normalization regression", () => {
  it("produces the same id for slash and hyphen variants of the same part", () => {
    const slash = runCli(["cluster", "bootstrap/secret"]);
    const hyphen = runCli(["cluster", "bootstrap-secret"]);

    expect(slash.exitCode).toBe(0);
    expect(hyphen.exitCode).toBe(0);

    const slashId = extractLine(slash.stdout, "id=");
    const hyphenId = extractLine(hyphen.stdout, "id=");
    expect(slashId).not.toBeNull();
    expect(slashId).toBe(hyphenId);
  });

  it("produces the same search token for slash and hyphen variants", () => {
    const slash = runCli(["cluster", "bootstrap/secret"]);
    const hyphen = runCli(["cluster", "bootstrap-secret"]);

    expect(extractLine(slash.stdout, "search=")).toBe(
      extractLine(hyphen.stdout, "search="),
    );
  });

  it("produces the same comment for slash and hyphen variants", () => {
    const slash = runCli(["cluster", "bootstrap/secret"]);
    const hyphen = runCli(["cluster", "bootstrap-secret"]);

    expect(extractLine(slash.stdout, "comment=")).toBe(
      extractLine(hyphen.stdout, "comment="),
    );
  });

  it("normalizes multiple slash-delimited parts correctly", () => {
    // e.g. "deploy/dev/secret" becomes "deploy-dev-secret"
    const slashed = runCli(["deploy", "deploy/dev/secret"]);
    const hyphenated = runCli(["deploy", "deploy-dev-secret"]);

    expect(slashed.exitCode).toBe(0);
    expect(extractLine(slashed.stdout, "id=")).toBe(
      extractLine(hyphenated.stdout, "id="),
    );
  });

  it("outputs a stable 12-hex-char fingerprint", () => {
    const result = runCli(["cluster", "bootstrap-secret"]);
    expect(result.exitCode).toBe(0);
    const id = extractLine(result.stdout, "id=");
    expect(id).toMatch(/^cluster-[0-9a-f]{12}$/);
  });

  it("exits 1 with no arguments", () => {
    const result = runCli([]);
    expect(result.exitCode).toBe(1);
  });

  it("exits 1 when only prefix is given", () => {
    const result = runCli(["cluster"]);
    expect(result.exitCode).toBe(1);
  });
});
