import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRpcSnapshot, diffRpcContracts, RpcContract } from "../check-rpc-contracts.js";

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

describe("check-rpc-contracts", () => {
  it("captures latest SECURITY DEFINER function contracts from migrations", () => {
    const root = makeTempDir("rpc-contracts-");
    const migrations = join(root, "supabase", "migrations");
    mkdirSync(migrations, { recursive: true });

    writeFileSync(
      join(migrations, "20260101000000_initial.sql"),
      `
      create or replace function public.a_demo_rpc(p_name text)
      returns jsonb
      language plpgsql
      security definer
      as $$ begin return '{}'::jsonb; end; $$;
      `,
      "utf-8"
    );

    writeFileSync(
      join(migrations, "20260102000000_override.sql"),
      `
      create or replace function public.a_demo_rpc(p_renamed text, p_flag boolean default false)
      returns text
      security definer
      language plpgsql
      as $$ begin return 'ok'; end; $$;

      create or replace function public.not_included(p_value text)
      returns text
      language sql
      as $$ select p_value $$;
      `,
      "utf-8"
    );

    const snapshot = buildRpcSnapshot(migrations);
    assert.equal(snapshot.length, 1);
    assert.equal(snapshot[0]?.name, "public.a_demo_rpc");
    assert.deepEqual(snapshot[0]?.args.map((arg) => arg.name), ["p_renamed", "p_flag"]);
    assert.equal(snapshot[0]?.returns, "text");
  });

  it("reports parameter removals, renames, and return type changes", () => {
    const baseline: RpcContract[] = [
      {
        name: "public.demo",
        args: [
          { name: "p_a", type: "text" },
          { name: "p_b", type: "jsonb" },
        ],
        returns: "jsonb",
      },
    ];

    const current: RpcContract[] = [
      {
        name: "public.demo",
        args: [{ name: "p_renamed", type: "text" }],
        returns: "text",
      },
    ];

    const findings = diffRpcContracts(baseline, current);
    assert.equal(findings.length, 3);
    assert.ok(findings.some((finding) => finding.kind === "return-type-changed"));
    assert.ok(findings.some((finding) => finding.kind === "parameter-renamed"));
    assert.ok(findings.some((finding) => finding.kind === "parameter-removed"));
  });

  it("reports removed RPCs, added parameters, and parameter type changes", () => {
    const baseline: RpcContract[] = [
      {
        name: "public.demo",
        args: [{ name: "p_query", type: "text" }],
        returns: "jsonb",
      },
      {
        name: "public.removed_rpc",
        args: [{ name: "p_id", type: "uuid" }],
        returns: "jsonb",
      },
    ];

    const current: RpcContract[] = [
      {
        name: "public.demo",
        args: [
          { name: "p_query", type: "jsonb" },
          { name: "p_tenant_id", type: "uuid" },
        ],
        returns: "jsonb",
      },
    ];

    const findings = diffRpcContracts(baseline, current);
    assert.ok(findings.some((finding) => finding.kind === "rpc-removed"));
    assert.ok(findings.some((finding) => finding.kind === "parameter-added"));
    assert.ok(findings.some((finding) => finding.kind === "parameter-type-changed"));
  });
});
