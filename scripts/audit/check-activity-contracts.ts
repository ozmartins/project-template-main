import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { type ContractFinding, fileIssueIfNeeded, summarizeFindings } from "./contract-common.js";

export interface ActivityContract {
  name: string;
  params: string[];
  requiredParams: string[];
}

export interface DefinitionActivityReference {
  file: string;
  workflow: string;
  activity: string;
  inputKeys: string[];
}

export interface TemporalContractSnapshot {
  activities: ActivityContract[];
  definitions: DefinitionActivityReference[];
}

function repoRoot(): string {
  return join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
}

function normalizeIdentifier(value: string): string {
  return value.replace(/"/g, "").trim();
}

interface ActivityParamContract {
  name: string;
  required: boolean;
}

function dedupeParamContracts(params: ActivityParamContract[]): ActivityParamContract[] {
  // This helper only deduplicates repeated property names emitted by recursive parsing.
  // Union/intersection required-vs-optional semantics are resolved in collectTypeProperties().
  const merged = new Map<string, boolean>();
  for (const param of params) {
    const current = merged.get(param.name);
    if (current === undefined) {
      merged.set(param.name, param.required);
      continue;
    }
    merged.set(param.name, current || param.required);
  }
  return [...merged.entries()]
    .map(([name, required]) => ({ name, required }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function collectTypeProperties(
  typeNode: ts.TypeNode | undefined,
  symbols: Map<string, ts.TypeNode>,
  visiting = new Set<string>(),
  depth = 0
): ActivityParamContract[] {
  if (!typeNode) return [];
  if (depth > 20) return [];

  if (ts.isTypeLiteralNode(typeNode)) {
    return typeNode.members
      .filter(ts.isPropertySignature)
      .map((member) => ({
        name: normalizeIdentifier(member.name.getText()),
        required: !member.questionToken,
      }));
  }

  if (ts.isTypeReferenceNode(typeNode)) {
    const name = typeNode.typeName.getText();
    if (visiting.has(name)) return [];
    visiting.add(name);
    const target = symbols.get(name);
    const keys = collectTypeProperties(target, symbols, visiting, depth + 1);
    visiting.delete(name);
    return keys;
  }

  if (ts.isUnionTypeNode(typeNode) || ts.isIntersectionTypeNode(typeNode)) {
    const requiredCounts = new Map<string, number>();
    const presenceCounts = new Map<string, number>();
    for (const node of typeNode.types) {
      for (const param of collectTypeProperties(node, symbols, visiting, depth + 1)) {
        presenceCounts.set(param.name, (presenceCounts.get(param.name) ?? 0) + 1);
        if (param.required) {
          requiredCounts.set(param.name, (requiredCounts.get(param.name) ?? 0) + 1);
        }
      }
    }
    return [...presenceCounts.entries()].map(([name, presenceCount]) => ({
      name,
      required: ts.isUnionTypeNode(typeNode)
        ? (requiredCounts.get(name) ?? 0) === typeNode.types.length
        : (requiredCounts.get(name) ?? 0) > 0,
    }));
  }

  if (ts.isParenthesizedTypeNode(typeNode)) {
    return collectTypeProperties(typeNode.type, symbols, visiting, depth + 1);
  }

  return [];
}

export function buildActivityContracts(activitiesDir: string): ActivityContract[] {
  if (!existsSync(activitiesDir)) return [];

  const files = readdirSync(activitiesDir)
    .filter((entry) => entry.endsWith(".ts") && entry !== "index.ts")
    .sort();

  const contracts: ActivityContract[] = [];

  for (const file of files) {
    const path = join(activitiesDir, file);
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf-8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    const symbols = new Map<string, ts.TypeNode>();
    for (const node of source.statements) {
      if (ts.isInterfaceDeclaration(node)) {
        symbols.set(node.name.text, ts.factory.createTypeLiteralNode([...node.members]));
      }
      if (ts.isTypeAliasDeclaration(node)) {
        symbols.set(node.name.text, node.type);
      }
    }

    for (const node of source.statements) {
      if (!ts.isFunctionDeclaration(node)) continue;
      if (!node.name) continue;
      if (!node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
        continue;

      const argType = node.parameters[0]?.type;
      const params = dedupeParamContracts(collectTypeProperties(argType, symbols));
      contracts.push({
        name: node.name.text,
        params: params.map((param) => param.name),
        requiredParams: params.filter((param) => param.required).map((param) => param.name),
      });
    }
  }

  return contracts.sort((a, b) => a.name.localeCompare(b.name));
}

function collectDefinitionReferences(
  node: unknown,
  file: string,
  workflow: string,
  out: DefinitionActivityReference[]
): void {
  if (!node || typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (const item of node) collectDefinitionReferences(item, file, workflow, out);
    return;
  }

  const obj = node as Record<string, unknown>;
  const activityNode = obj.activity;
  if (activityNode && typeof activityNode === "object") {
    const activity = activityNode as Record<string, unknown>;
    const name = typeof activity.name === "string" ? activity.name : undefined;
    const args = activity.args;
    const inputKeys =
      args && typeof args === "object" && !Array.isArray(args)
        ? Object.keys(args as Record<string, unknown>).sort()
        : [];
    if (name) {
      out.push({ file, workflow, activity: name, inputKeys });
    }
  }

  for (const value of Object.values(obj)) {
    collectDefinitionReferences(value, file, workflow, out);
  }
}

export function buildDefinitionReferences(definitionsDir: string): DefinitionActivityReference[] {
  if (!existsSync(definitionsDir)) return [];

  const files = readdirSync(definitionsDir)
    .filter((entry) => entry.endsWith(".json"))
    .sort();

  const references: DefinitionActivityReference[] = [];
  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(definitionsDir, file), "utf-8")) as Record<
      string,
      unknown
    >;
    const workflow = typeof raw.name === "string" ? raw.name : file;
    collectDefinitionReferences(raw, file, workflow, references);
  }

  return references.sort((a, b) =>
    `${a.file}:${a.activity}`.localeCompare(`${b.file}:${b.activity}`)
  );
}

function readBaseline(path: string): TemporalContractSnapshot {
  if (!existsSync(path)) {
    return { activities: [], definitions: [] };
  }
  const parsed = JSON.parse(readFileSync(path, "utf-8")) as TemporalContractSnapshot;
  const activities = (parsed.activities ?? []).map((activity) => {
    const params = (activity.params ?? [])
      .map((param) => String(param))
      .filter(Boolean)
      .sort();

    const requiredParams = [...new Set((activity.requiredParams ?? []).map((name) => String(name)).filter(Boolean))]
      .sort();

    return {
      name: activity.name,
      params,
      requiredParams,
    };
  });
  return {
    activities: activities.sort((a, b) => a.name.localeCompare(b.name)),
    definitions: [...(parsed.definitions ?? [])],
  };
}

function writeSnapshot(path: string, snapshot: TemporalContractSnapshot): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf-8");
}

export function diffTemporalContracts(
  baseline: TemporalContractSnapshot,
  current: TemporalContractSnapshot
): ContractFinding[] {
  const findings: ContractFinding[] = [];

  const currentActivities = new Map(
    current.activities.map((activity) => [activity.name, activity])
  );
  for (const previous of baseline.activities) {
    const next = currentActivities.get(previous.name);
    if (!next) continue;

    for (let i = 0; i < previous.params.length; i += 1) {
      const priorName = previous.params[i]!;
      const currentName = next.params[i];
      if (!currentName) {
        findings.push({
          kind: "activity-parameter-removed",
          message: `${previous.name} removed parameter \`${priorName}\` at position ${i + 1}`,
        });
        continue;
      }
      if (priorName !== currentName) {
        findings.push({
          kind: "activity-parameter-renamed",
          message: `${previous.name} parameter ${i + 1} renamed from \`${priorName}\` to \`${currentName}\``,
        });
      }
    }
  }

  for (const ref of current.definitions) {
    const contract = currentActivities.get(ref.activity);
    if (!contract) {
      findings.push({
        kind: "definition-unknown-activity",
        message: `${ref.file} references activity \`${ref.activity}\` that is not exported by temporal/src/activities`,
      });
      continue;
    }

    const valid = new Set(contract.params);
    const provided = new Set(ref.inputKeys);
    const missingRequired = contract.requiredParams.filter((key) => !provided.has(key));
    if (missingRequired.length > 0) {
      findings.push({
        kind: "definition-missing-required-input-key",
        message: `${ref.file} calls \`${ref.activity}\` without required keys: ${missingRequired.map((key) => `\`${key}\``).join(", ")}`,
      });
    }

    const unknown = ref.inputKeys.filter((key) => !valid.has(key));
    if (unknown.length > 0) {
      findings.push({
        kind: "definition-unknown-input-key",
        message: `${ref.file} calls \`${ref.activity}\` with unknown keys: ${unknown.map((key) => `\`${key}\``).join(", ")}`,
      });
    }
  }

  return findings;
}

export async function runActivityContractCheck(options?: {
  root?: string;
  snapshotPath?: string;
  updateBaseline?: boolean;
}): Promise<{ findings: ContractFinding[]; snapshot: TemporalContractSnapshot }> {
  const root = options?.root ?? repoRoot();
  const snapshotPath = options?.snapshotPath ?? join(root, "temporal", "contract-snapshot.json");

  const snapshot: TemporalContractSnapshot = {
    activities: buildActivityContracts(join(root, "temporal", "src", "activities")),
    definitions: buildDefinitionReferences(join(root, "temporal", "definitions")),
  };

  if (options?.updateBaseline || !existsSync(snapshotPath)) {
    writeSnapshot(snapshotPath, snapshot);
  }

  const baseline = readBaseline(snapshotPath);
  const findings = diffTemporalContracts(baseline, snapshot);
  summarizeFindings("Temporal Activity Contract Drift", findings);

  if (findings.length > 0) {
    await fileIssueIfNeeded({
      title: "[contract-drift] Temporal activity contract mismatches need development review",
      labels: ["queue:development", "priority:high"],
      intro: "Detected Temporal activity signature and definition contract mismatches.",
      findings,
    });
  }

  return { findings, snapshot };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const updateBaseline =
    process.argv.includes("--update-baseline") || process.argv.includes("--update-baselines");
  runActivityContractCheck({ updateBaseline }).catch((error) => {
    process.stderr.write(`Activity contract check failed: ${(error as Error).message}\n`);
    process.exit(1);
  });
}
