import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { run, scanMigrations } from "../check-view-security-invoker.js";

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

describe("check-view-security-invoker", () => {
  it("flags views missing security_invoker and clears findings when later migrations add it", () => {
    const root = makeTempDir("view-security-");
    const migrationsDir = join(root, "supabase", "migrations");
    mkdirSync(migrationsDir, { recursive: true });

    writeFileSync(
      join(migrationsDir, "20260101000000_create_views.sql"),
      `create view public.unsafe_view as select 1;\ncreate or replace view public.safe_later as select 2;\n`,
      "utf-8"
    );

    writeFileSync(
      join(migrationsDir, "20260102000000_fix_safe_later.sql"),
      `create or replace view public.safe_later with (security_invoker = true) as select 2;\n`,
      "utf-8"
    );

    const findings = scanMigrations(migrationsDir);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].check, "view-security-invoker");
    assert.equal(findings[0].severity, "HIGH");
    assert.match(findings[0].location, /supabase\/migrations\/20260101000000_create_views\.sql:1/);
    assert.match(findings[0].message, /unsafe_view/);

    const result = run(root);
    assert.equal(result.name, "view-security-invoker");
    assert.equal(result.findings.length, 1);
  });

  it("does not flag views that declare security_invoker inline", () => {
    const root = makeTempDir("view-security-inline-");
    const migrationsDir = join(root, "supabase", "migrations");
    mkdirSync(migrationsDir, { recursive: true });

    writeFileSync(
      join(migrationsDir, "20260101000000_safe_views.sql"),
      `create or replace view public.my_view with (security_invoker = true) as select 1;\n`,
      "utf-8"
    );

    assert.deepEqual(scanMigrations(migrationsDir), []);
  });

  it("returns empty findings when the migrations directory does not exist", () => {
    assert.deepEqual(scanMigrations("/nonexistent/supabase/migrations"), []);
  });

  it("returns empty findings when SQL files contain no view definitions", () => {
    const root = makeTempDir("view-security-no-views-");
    const migrationsDir = join(root, "supabase", "migrations");
    mkdirSync(migrationsDir, { recursive: true });

    writeFileSync(
      join(migrationsDir, "20260101000000_tables_only.sql"),
      `create table public.things (id uuid primary key default gen_random_uuid());\n`,
      "utf-8"
    );

    assert.deepEqual(scanMigrations(migrationsDir), []);
  });
});
