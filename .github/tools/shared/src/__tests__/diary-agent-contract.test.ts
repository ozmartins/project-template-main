import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "../../../../../");
const AGENT_PATH = join(REPO_ROOT, ".github/agents/diary-agent.agent.md");

function readDiaryAgentPrompt(): string {
  return readFileSync(AGENT_PATH, "utf8");
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("diary-agent prompt contract", () => {
  it("keeps one canonical Guardrails section with required guardrails exactly once", () => {
    const prompt = readDiaryAgentPrompt();

    expect(countOccurrences(prompt, "## Guardrails")).toBe(1);
    expect(
      countOccurrences(
        prompt,
        "- **Evidence-first.** Base every statement on gathered outputs; no speculation."
      )
    ).toBe(1);
    expect(
      countOccurrences(
        prompt,
        "- **Degrade gracefully.** Missing data means a direct note in that section, not a crash."
      )
    ).toBe(1);
  });

  it("retains the canonical python3 ISO week/lookback path with documented fallbacks and non-empty guards", () => {
    const prompt = readDiaryAgentPrompt();

    expect(prompt).toContain("if command -v python3 >/dev/null 2>&1; then");
    expect(prompt).toContain(
      'ISO_WEEK=$(python3 -c "from datetime import datetime, timezone; print(datetime.now(timezone.utc).strftime(\'%G-W%V\'))")'
    );
    expect(prompt).toContain("elif date -u -v-0d '+%G-W%V' >/dev/null 2>&1; then");
    expect(prompt).toContain("ISO_WEEK=$(date -u -v-0d '+%G-W%V')");
    expect(prompt).toContain("ISO_WEEK=$(date -u '+%G-W%V')");
    expect(prompt).toContain('[ -n "$ISO_WEEK" ] || { echo "Failed to compute ISO_WEEK"; exit 1; }');

    expect(prompt).toContain(
      'SINCE=$(python3 -c "from datetime import datetime, timedelta, timezone; print((datetime.now(timezone.utc) - timedelta(days=7)).strftime(\'%Y-%m-%dT%H:%M:%SZ\'))")'
    );
    expect(prompt).toContain("elif date -u -d '7 days ago' '+%Y-%m-%dT%H:%M:%SZ' >/dev/null 2>&1; then");
    expect(prompt).toContain("SINCE=$(date -u -d '7 days ago' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null)");
    expect(prompt).toContain("SINCE=$(date -u -v-7d '+%Y-%m-%dT%H:%M:%SZ')");
    expect(prompt).toContain('[ -n "$SINCE" ] || { echo "Failed to compute SINCE"; exit 1; }');
  });

  it("keeps diary-agent write scope restricted to docs/diary", () => {
    const prompt = readDiaryAgentPrompt();

    expect(prompt).toContain("write to `docs/diary/`");
    expect(prompt).toContain("Write `docs/diary/${ISO_WEEK}.md`:");
    expect(prompt).toContain("Write the updated `docs/diary/README.md`.");
    expect(prompt).toContain("git add docs/diary/");
    expect(prompt).toContain("- **Never modify files outside `docs/diary/`.**");

    expect(prompt).not.toContain("git add .");
    expect(prompt).not.toContain("git add -A");
  });
});
