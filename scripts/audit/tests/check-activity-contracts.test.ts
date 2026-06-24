import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildActivityContracts,
  buildDefinitionReferences,
  diffTemporalContracts,
  TemporalContractSnapshot,
} from "../check-activity-contracts.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("check-activity-contracts", () => {
  it("extracts exported activity params from interfaces", () => {
    const root = makeTempDir("activity-contracts-");
    const activities = join(root, "temporal", "src", "activities");
    mkdirSync(activities, { recursive: true });

    writeFileSync(
      join(activities, "alpha.ts"),
      `
      export interface AlphaArgs {
        query: string;
        limit?: number;
      }

      export async function alpha(args: AlphaArgs): Promise<void> {
        void args;
      }
      `,
      "utf-8"
    );

    const contracts = buildActivityContracts(activities);
    assert.deepEqual(contracts, [
      { name: "alpha", params: ["limit", "query"], requiredParams: ["query"] },
    ]);
  });

  it("flags unknown activities and unknown input keys from definitions", () => {
    const baseline: TemporalContractSnapshot = {
      activities: [{ name: "alpha", params: ["query", "limit"], requiredParams: ["query"] }],
      definitions: [],
    };

    const current: TemporalContractSnapshot = {
      activities: [{ name: "alpha", params: ["q"], requiredParams: ["q"] }],
      definitions: [
        {
          file: "demo.json",
          workflow: "demo",
          activity: "alpha",
          inputKeys: ["query", "unknown_key"],
        },
        {
          file: "demo.json",
          workflow: "demo",
          activity: "missing_activity",
          inputKeys: ["query"],
        },
      ],
    };

    const findings = diffTemporalContracts(baseline, current);
    assert.ok(findings.some((finding) => finding.kind === "activity-parameter-renamed"));
    assert.ok(findings.some((finding) => finding.kind === "definition-unknown-input-key"));
    assert.ok(findings.some((finding) => finding.kind === "definition-unknown-activity"));
  });

  it("flags definitions missing newly required activity input keys", () => {
    const baseline: TemporalContractSnapshot = {
      activities: [{ name: "alpha", params: ["query"], requiredParams: ["query"] }],
      definitions: [],
    };

    const current: TemporalContractSnapshot = {
      activities: [
        { name: "alpha", params: ["query", "tenant_id"], requiredParams: ["query", "tenant_id"] },
      ],
      definitions: [
        {
          file: "demo.json",
          workflow: "demo",
          activity: "alpha",
          inputKeys: ["query"],
        },
      ],
    };

    const findings = diffTemporalContracts(baseline, current);
    assert.ok(
      findings.some((finding) => finding.kind === "definition-missing-required-input-key")
    );
  });

  it("collects activity references from nested definition JSON", () => {
    const root = makeTempDir("definition-references-");
    const definitions = join(root, "temporal", "definitions");
    mkdirSync(definitions, { recursive: true });

    writeFileSync(
      join(definitions, "demo.json"),
      JSON.stringify(
        {
          name: "demo",
          steps: {
            sequence: {
              steps: [
                { activity: { name: "alpha", args: { query: "$input.query" } } },
                {
                  for_each: {
                    body: {
                      sequence: {
                        steps: [{ activity: { name: "beta", args: { count: 1 } } }],
                      },
                    },
                  },
                },
              ],
            },
          },
        },
        null,
        2
      ),
      "utf-8"
    );

    const refs = buildDefinitionReferences(definitions);
    assert.equal(refs.length, 2);
    assert.deepEqual(
      refs.map((ref) => [ref.activity, ref.inputKeys]),
      [
        ["alpha", ["query"]],
        ["beta", ["count"]],
      ]
    );
  });
});
