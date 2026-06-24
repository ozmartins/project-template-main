import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const temporalRoot = resolve(__dirname, "..");
const migrationsDir = resolve(temporalRoot, "..", "supabase", "migrations");
const seedPath = resolve(temporalRoot, "..", "supabase", "seed.sql");
const fixtureDir = resolve(temporalRoot, "tests", "fixtures", "ontology-lint");

function runOntologyLint(args: string[]) {
  return spawnSync("npx", ["ts-node", "scripts/lint-ontology.ts", ...args], {
    cwd: temporalRoot,
    encoding: "utf8",
  });
}

describe("lint-ontology script", () => {
  it("passes current migrations and seed", () => {
    const result = runOntologyLint([migrationsDir, seedPath]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("0 violations");
  });

  it("fails when entity_facts.value is non-numeric (rule1)", () => {
    const result = runOntologyLint([
      resolve(fixtureDir, "rule1-nonnumeric-entity-facts-value.sql"),
    ]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("[rule1]");
  });

  it("fails when a referenced fact_type key is not registered (rule2)", () => {
    const result = runOntologyLint([resolve(fixtureDir, "rule2-missing-fact-type-key.sql")]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("[rule2]");
  });

  it("fails when a top-level table name is outside ontology shape (rule3)", () => {
    const result = runOntologyLint([resolve(fixtureDir, "rule3-invalid-top-level-table.sql")]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("[rule3]");
  });
});
