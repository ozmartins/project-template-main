/**
 * Audit: Postgres views exposed via PostgREST declare security_invoker.
 *
 * A view without `WITH (security_invoker = true)` runs with the owner's privileges
 * and bypasses base-table RLS. The frontend queries views, so this makes RLS
 * non-load-bearing on the real surface even after anon read is removed (see #272).
 *
 * Heuristic (textual): for each `CREATE [OR REPLACE] VIEW <name>`, inspect the
 * text up to the view body (`AS`) for `security_invoker`. A later migration that
 * adds `security_invoker` to the same view clears the finding.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckResult, Finding } from "./common.js";
import { repoRoot } from "./common.js";

const CREATE_VIEW =
  /create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?([A-Za-z0-9_."]+)/gi;

export function scanMigrations(migrationsDir: string): Finding[] {
  if (!existsSync(migrationsDir)) return [];

  // Track the latest finding per view name — a later migration that adds
  // security_invoker clears the finding from an earlier one.
  const findingsByView = new Map<string, Finding>();

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const text = readFileSync(join(migrationsDir, file), "utf-8");
    const rel = `supabase/migrations/${file}`;

    for (const match of text.matchAll(CREATE_VIEW)) {
      const viewName = match[1];
      const normalizedName = viewName.replace(/"/g, "").toLowerCase();
      const tail = text.slice(match.index + match[0].length);
      const asMatch = /\bas\b/i.exec(tail);
      const header = asMatch ? tail.slice(0, asMatch.index) : tail.slice(0, 200);

      if (/security_invoker/i.test(header)) {
        // A migration explicitly sets security_invoker — clear any prior finding.
        findingsByView.delete(normalizedName);
        continue;
      }

      const line = text.slice(0, match.index).split("\n").length;
      findingsByView.set(normalizedName, {
        check: "view-security-invoker",
        severity: "HIGH",
        location: `${rel}:${line}`,
        message: `View \`${viewName}\` is created without \`WITH (security_invoker = true)\` — it bypasses base-table RLS.`,
        issue: "#272",
      });
    }
  }

  return [...findingsByView.values()].sort((a, b) => a.location.localeCompare(b.location));
}

export function run(root?: string): CheckResult {
  const r = root ?? repoRoot();
  return {
    name: "view-security-invoker",
    findings: scanMigrations(join(r, "supabase", "migrations")),
  };
}
