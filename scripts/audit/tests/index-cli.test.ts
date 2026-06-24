import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

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

const auditFiles = [
  "common.ts",
  "check-workflow-security.ts",
  "check-view-security-invoker.ts",
  "check-temporal-registration.ts",
  "index.ts",
];

function createFixtureRepo(): { fixtureRoot: string; fixtureIndexPath: string } {
  const fixtureRoot = makeTempDir("audit-cli-");
  const fixtureAuditDir = join(fixtureRoot, "scripts", "audit");
  mkdirSync(fixtureAuditDir, { recursive: true });

  const sourceAuditDir = join(process.cwd());
  for (const file of auditFiles) {
    copyFileSync(join(sourceAuditDir, file), join(fixtureAuditDir, file));
  }

  const workflowsDir = join(fixtureRoot, ".github", "workflows");
  mkdirSync(workflowsDir, { recursive: true });
  writeFileSync(
    join(workflowsDir, "unsafe.yml"),
    "on:\n  pull_request_target:\njobs:\n  run:\n    steps:\n      - run: echo \"${{ secrets.COPILOT_TOKEN }}\"\n",
    "utf-8"
  );

  const migrationsDir = join(fixtureRoot, "supabase", "migrations");
  mkdirSync(migrationsDir, { recursive: true });
  writeFileSync(join(migrationsDir, "20260101000000_bad_view.sql"), "create view public.unsafe as select 1;\n", "utf-8");

  const temporalSrc = join(fixtureRoot, "temporal", "src");
  const activitiesDir = join(temporalSrc, "activities");
  mkdirSync(activitiesDir, { recursive: true });
  writeFileSync(join(activitiesDir, "orphan.ts"), "export const orphan = () => null;\n", "utf-8");
  writeFileSync(join(temporalSrc, "worker.ts"), "export const worker = {};\n", "utf-8");

  return { fixtureRoot, fixtureIndexPath: join(fixtureAuditDir, "index.ts") };
}

describe("audit CLI", () => {
  it("keeps report mode non-blocking but exits non-zero in strict mode when findings exist", () => {
    const { fixtureRoot, fixtureIndexPath } = createFixtureRepo();

    const reportResult = spawnSync("node", ["--import", "tsx", fixtureIndexPath], {
      cwd: join(process.cwd()),
      encoding: "utf-8",
    });
    assert.equal(reportResult.status, 0);
    assert.match(reportResult.stdout, /Architecture Audit/);
    assert.match(reportResult.stderr, /finding\(s\)/);

    const strictResult = spawnSync("node", ["--import", "tsx", fixtureIndexPath, "--strict"], {
      cwd: join(process.cwd()),
      encoding: "utf-8",
    });
    assert.equal(strictResult.status, 1);
    assert.match(strictResult.stderr, /finding\(s\)/);

    assert.ok(fixtureRoot.length > 0);
  });

  it("exits 0 in strict mode when there are no findings", () => {
    const fixtureRoot = makeTempDir("audit-cli-clean-");
    const fixtureAuditDir = join(fixtureRoot, "scripts", "audit");
    mkdirSync(fixtureAuditDir, { recursive: true });

    const sourceAuditDir = join(process.cwd());
    for (const file of auditFiles) {
      copyFileSync(join(sourceAuditDir, file), join(fixtureAuditDir, file));
    }

    // Provide directories that satisfy all checks with no findings
    mkdirSync(join(fixtureRoot, ".github", "workflows"), { recursive: true });
    mkdirSync(join(fixtureRoot, "supabase", "migrations"), { recursive: true });
    const temporalSrc = join(fixtureRoot, "temporal", "src");
    const activitiesDir = join(temporalSrc, "activities");
    mkdirSync(activitiesDir, { recursive: true });
    writeFileSync(join(activitiesDir, "index.ts"), "export {};\n", "utf-8");
    writeFileSync(join(temporalSrc, "worker.ts"), "export const worker = {};\n", "utf-8");

    const strictResult = spawnSync("node", ["--import", "tsx", join(fixtureAuditDir, "index.ts"), "--strict"], {
      // cwd must remain the scripts/audit directory so that Node can resolve the
      // locally-installed tsx package from its node_modules; fixtureRoot has no node_modules.
      cwd: join(process.cwd()),
      encoding: "utf-8",
    });
    assert.equal(strictResult.status, 0, `strict mode must exit 0 with no findings (stderr: ${strictResult.stderr})`);
    assert.match(strictResult.stdout, /No findings/);
  });
});
