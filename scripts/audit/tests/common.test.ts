import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../common.js";

describe("renderMarkdown", () => {
  it("escapes markdown table-breaking pipes and backslashes in findings", () => {
    const report = renderMarkdown([
      {
        name: "test-check",
        findings: [
          {
            check: "workflow-security",
            severity: "HIGH",
            location: ".github/workflows/test.yml",
            message: String.raw`raw\path | pipe`,
            issue: "#1",
          },
        ],
      },
    ]);

    assert.match(report, /raw\\\\path \\| pipe/);
  });

  it("returns a clean no-findings message when all checks pass", () => {
    const report = renderMarkdown([{ name: "workflow-security", findings: [] }]);

    assert.match(report, /No findings/);
    // The markdown table header separator row is the reliable marker for a findings table.
    assert.ok(!report.includes("|---|"), "clean report must not contain a findings table");
  });

  it("includes the Architecture Audit heading and finding count in the report", () => {
    const report = renderMarkdown([
      {
        name: "workflow-security",
        findings: [
          {
            check: "workflow-security",
            severity: "CRITICAL",
            location: ".github/workflows/bad.yml",
            message: "uses pull_request_target with secrets",
            issue: "#274",
          },
        ],
      },
    ]);

    assert.match(report, /## Architecture Audit/);
    assert.match(report, /\*\*1\*\* finding/);
    assert.match(report, /CRITICAL/);
    assert.match(report, /#274/);
  });
});
