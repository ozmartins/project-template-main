import { log } from "@temporalio/activity";
import { config } from "../config";

export interface EvaluateDecisionArgs {
  table: string;
  version?: string; // "current" or semver; default "current"
  input: Record<string, unknown>;
  _idempotency_key?: string;
}

interface DecisionRule {
  conditions: Record<string, string>;
  outputs: Record<string, unknown>;
  annotation?: string;
}

interface DecisionTable {
  name: string;
  version: string;
  hit_policy: "first" | "all" | "unique";
  inputs: Array<{ name: string; type: string }>;
  outputs: Array<{ name: string; type: string }>;
  rules: DecisionRule[];
}

function matchesCondition(value: unknown, expr: string): boolean {
  const s = expr.trim();
  const num = parseFloat(s.replace(/^[><=!]+/, ""));
  if (s.startsWith(">=")) return Number(value) >= num;
  if (s.startsWith("<=")) return Number(value) <= num;
  if (s.startsWith(">")) return Number(value) > num;
  if (s.startsWith("<")) return Number(value) < num;
  if (s.startsWith("!=")) return String(value) !== s.slice(2).trim().replace(/^"|"$/g, "");
  // equality — strip optional quotes
  const expected = s.replace(/^"|"$/g, "");
  return String(value) === expected;
}

function matchesRule(rule: DecisionRule, input: Record<string, unknown>): boolean {
  for (const [col, expr] of Object.entries(rule.conditions)) {
    if (!expr) continue; // empty condition = wildcard
    if (!matchesCondition(input[col], expr)) return false;
  }
  return true;
}

export async function evaluate_decision(
  args: EvaluateDecisionArgs
): Promise<Record<string, unknown>> {
  log.info("evaluate_decision", { table: args.table, version: args.version ?? "current" });

  // Fetch decision table from Supabase
  const version = args.version ?? "current";
  const versionFilter =
    version === "current" ? "is_active=eq.true" : `version=eq.${encodeURIComponent(version)}`;

  const url = `${config.supabaseUrl}/rest/v1/decision_tables?name=eq.${encodeURIComponent(args.table)}&${versionFilter}&limit=1`;

  let table: DecisionTable;
  try {
    const response = await fetch(url, {
      headers: {
        apikey: config.supabaseServiceKey,
        Authorization: `Bearer ${config.supabaseServiceKey}`,
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = (await response.json()) as DecisionTable[];
    if (!rows.length) throw new Error(`Decision table not found: ${args.table}`);
    table = rows[0];
  } catch (err) {
    log.warn("[STUB] evaluate_decision: falling back to stub (Supabase unreachable)", {
      error: String(err),
    });
    return { _stub: true, approved: true };
  }

  if (table.hit_policy === "all") {
    const matched = table.rules.filter((r) => matchesRule(r, args.input));
    return { results: matched.map((r) => r.outputs) };
  }

  const match = table.rules.find((r) => matchesRule(r, args.input));
  if (!match)
    throw new Error(
      `No matching rule in decision table "${args.table}" for input ${JSON.stringify(args.input)}`
    );
  return match.outputs;
}
