import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ContractFinding, fileIssueIfNeeded, summarizeFindings } from "./contract-common.js";

export interface RpcArgContract {
  name: string;
  type: string;
}

export interface RpcContract {
  name: string;
  args: RpcArgContract[];
  returns: string;
}

function repoRoot(): string {
  return join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeIdentifier(value: string): string {
  return value.replace(/"/g, "").trim().toLowerCase();
}

function stripComments(sql: string): string {
  const withoutBlocks = sql.replace(/\/\*[\s\S]*?\*\//g, " ");
  return withoutBlocks.replace(/--[^\n\r]*/g, " ");
}

function findMatchingParen(text: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    const char = text[i];
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevelCsv(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function parseArg(arg: string, index: number): RpcArgContract {
  const withoutDefault = arg.split(/\bdefault\b/i, 1)[0]?.trim() ?? arg.trim();
  const withoutMode = withoutDefault.replace(/^\s*(inout|in|out|variadic)\s+/i, "");
  const tokens = withoutMode.split(/\s+/).filter(Boolean);

  if (tokens.length >= 2) {
    const name = normalizeIdentifier(tokens[0]!);
    const type = normalizeWhitespace(withoutMode.slice(tokens[0]!.length));
    if (!type) {
      return { name, type: "unknown" };
    }
    return { name, type };
  }

  const fallbackType = normalizeWhitespace(withoutMode) || "unknown";
  return { name: `$${index + 1}`, type: fallbackType };
}

function parseFunctionContracts(sql: string): RpcContract[] {
  const text = stripComments(sql);
  const matches = [
    ...text.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([a-zA-Z0-9_."$]+)\s*\(/gi),
  ];
  const contracts: RpcContract[] = [];

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i]!;
    const name = normalizeIdentifier(match[1]!);
    const openParenIndex = (match.index ?? 0) + match[0].length - 1;
    const closeParenIndex = findMatchingParen(text, openParenIndex);
    if (closeParenIndex < 0) continue;

    const argsRaw = text.slice(openParenIndex + 1, closeParenIndex).trim();
    const nextStart = matches[i + 1]?.index ?? text.length;
    const statement = text.slice(match.index ?? 0, nextStart);
    if (!/\bsecurity\s+definer\b/i.test(statement)) continue;

    const tail = text.slice(closeParenIndex + 1, nextStart);
    const returnsMatch =
      /\breturns\b([\s\S]*?)(?=\b(language|security|set|as|immutable|stable|volatile|strict|cost|rows|parallel)\b)/i.exec(
        tail
      );
    if (!returnsMatch) continue;

    const args = splitTopLevelCsv(argsRaw).map((arg, index) => parseArg(arg, index));
    contracts.push({
      name,
      args,
      returns: normalizeWhitespace(returnsMatch[1] ?? "unknown"),
    });
  }

  return contracts;
}

export function buildRpcSnapshot(migrationsDir: string): RpcContract[] {
  if (!existsSync(migrationsDir)) return [];

  const files = readdirSync(migrationsDir)
    .filter((entry) => entry.endsWith(".sql"))
    .sort();

  const byName = new Map<string, RpcContract>();
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    for (const contract of parseFunctionContracts(sql)) {
      byName.set(contract.name, contract);
    }
  }

  return [...byName.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((contract) => ({
      ...contract,
      args: [...contract.args],
    }));
}

function readBaseline(path: string): RpcContract[] {
  if (!existsSync(path)) return [];
  const data = JSON.parse(readFileSync(path, "utf-8")) as RpcContract[];
  return [...data].sort((a, b) => a.name.localeCompare(b.name));
}

export function diffRpcContracts(
  baseline: RpcContract[],
  current: RpcContract[]
): ContractFinding[] {
  const findings: ContractFinding[] = [];
  const currentByName = new Map(current.map((contract) => [contract.name, contract]));

  for (const previous of baseline) {
    const now = currentByName.get(previous.name);
    if (!now) {
      findings.push({
        kind: "rpc-removed",
        message: `RPC \`${previous.name}\` no longer exists in the current snapshot`,
      });
      continue;
    }

    if (previous.returns !== now.returns) {
      findings.push({
        kind: "return-type-changed",
        message: `${previous.name} returns changed from \`${previous.returns}\` to \`${now.returns}\``,
      });
    }

    for (let i = 0; i < previous.args.length; i += 1) {
      const priorArg = previous.args[i]!;
      const newArg = now.args[i];
      if (!newArg) {
        findings.push({
          kind: "parameter-removed",
          message: `${previous.name} removed parameter \`${priorArg.name}\` at position ${i + 1}`,
        });
        continue;
      }

      if (priorArg.name !== newArg.name) {
        findings.push({
          kind: "parameter-renamed",
          message: `${previous.name} parameter ${i + 1} renamed from \`${priorArg.name}\` to \`${newArg.name}\``,
        });
      }

      if (priorArg.type !== newArg.type) {
        findings.push({
          kind: "parameter-type-changed",
          message: `${previous.name} parameter \`${newArg.name}\` at position ${i + 1} changed type from \`${priorArg.type}\` to \`${newArg.type}\``,
        });
      }
    }

    for (let i = previous.args.length; i < now.args.length; i += 1) {
      const addedArg = now.args[i]!;
      findings.push({
        kind: "parameter-added",
        message: `${previous.name} added parameter \`${addedArg.name}\` at position ${i + 1}`,
      });
    }
  }

  return findings;
}

function writeSnapshot(path: string, snapshot: RpcContract[]): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf-8");
}

export async function runRpcContractCheck(options?: {
  root?: string;
  snapshotPath?: string;
  updateBaseline?: boolean;
}): Promise<{ findings: ContractFinding[]; snapshot: RpcContract[] }> {
  const root = options?.root ?? repoRoot();
  const snapshotPath = options?.snapshotPath ?? join(root, "supabase", "contract-snapshot.json");

  const snapshot = buildRpcSnapshot(join(root, "supabase", "migrations"));
  if (options?.updateBaseline || !existsSync(snapshotPath)) {
    writeSnapshot(snapshotPath, snapshot);
  }

  const baseline = readBaseline(snapshotPath);
  const findings = diffRpcContracts(baseline, snapshot);
  summarizeFindings("Supabase RPC Contract Drift", findings);

  if (findings.length > 0) {
    await fileIssueIfNeeded({
      title: "[contract-drift] Supabase RPC contract changes need database review",
      labels: ["needs-database-review", "priority:high"],
      intro:
        "Detected potentially breaking Supabase RPC contract changes (SECURITY DEFINER function surface).",
      findings,
    });
  }

  return { findings, snapshot };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const updateBaseline =
    process.argv.includes("--update-baseline") || process.argv.includes("--update-baselines");
  runRpcContractCheck({ updateBaseline }).catch((error) => {
    process.stderr.write(`RPC contract check failed: ${(error as Error).message}\n`);
    process.exit(1);
  });
}
