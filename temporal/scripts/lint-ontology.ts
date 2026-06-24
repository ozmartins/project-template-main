/**
 * Ontology lints — enforce the project-template schema grammar rules.
 *
 * Rule 1: entity_facts.value must be a numeric column type.
 * Rule 2: Every fact_type key referenced via fact_types WHERE key='...'
 *         sub-selects must have been inserted into fact_types in this file
 *         or an earlier migration (files sorted by name).
 * Rule 3: New top-level CREATE TABLE statements must use the ontology shape —
 *         names must match ONTOLOGY_NAMED_TABLES, APPLICATION_NAMED_TABLES,
 *         or begin with an allowed prefix (dim_, fact_).
 *
 * Usage (from repo root):
 *   cd temporal && npx ts-node scripts/lint-ontology.ts
 *   cd temporal && npx ts-node scripts/lint-ontology.ts ../supabase/migrations/some.sql
 *
 * Exits 0 if all rules pass, 1 if any violations are found.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';

// ---------------------------------------------------------------------------
// Rule 3 vocabulary
// ---------------------------------------------------------------------------

const ONTOLOGY_NAMED_TABLES = new Set([
  'entities',
  'entity_versions',
  'entity_facts',
  'fact_types',
  'relationships',
  'relationships_v2',
  'time_series_points',
]);

// Application-layer tables that live alongside the ontology but don't follow
// the ontology naming convention. Extend when adding new first-class tables.
const APPLICATION_NAMED_TABLES = new Set([
  'workflow_definitions',
  'workflow_definition_audit_log',
  'decision_tables',
  'workflow_executions',
  'workflow_execution_steps',
  'workflow_signals',
  'workflow_classifications',
  'workflow_document_extractions',
  'documents',
]);

const ONTOLOGY_PREFIXES = ['dim_', 'fact_'];

// ---------------------------------------------------------------------------
// Rule 1 vocabulary
// ---------------------------------------------------------------------------

const NUMERIC_TYPES = new Set([
  'smallint', 'int2',
  'integer', 'int', 'int4',
  'bigint', 'int8',
  'decimal', 'numeric',
  'real', 'float4',
  'double', 'float8',
  'money',
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Violation {
  rule: string;
  file: string;
  detail: string;
}

function fmtViolation(v: Violation): string {
  return `[${v.rule}] ${v.file}: ${v.detail}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripComments(sql: string): string {
  sql = sql.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
  return sql.split('\n').map((line) => line.replace(/--.*$/, '')).join('\n');
}

const CREATE_TABLE_RE =
  /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([\s\S]*?)\)\s*;/gi;

function findValueColumnType(tableBody: string): string | null {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of tableBody) {
    if (ch === '(') { depth++; current += ch; }
    else if (ch === ')') { depth--; current += ch; }
    else if (ch === ',' && depth === 0) { parts.push(current); current = ''; }
    else { current += ch; }
  }
  if (current) parts.push(current);

  for (const part of parts) {
    const m = part.trim().match(/^value\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

function scanCreateTables(sql: string, file: string): Violation[] {
  const violations: Violation[] = [];
  let m: RegExpExecArray | null;
  CREATE_TABLE_RE.lastIndex = 0;
  while ((m = CREATE_TABLE_RE.exec(sql)) !== null) {
    const tableName = m[1].toLowerCase();
    const tableBody = m[2];

    if (
      !ONTOLOGY_NAMED_TABLES.has(tableName) &&
      !APPLICATION_NAMED_TABLES.has(tableName) &&
      !ONTOLOGY_PREFIXES.some((p) => tableName.startsWith(p))
    ) {
      violations.push({
        rule: 'rule3',
        file,
        detail:
          `CREATE TABLE '${tableName}' is outside the ontology shape. ` +
          `Add it to APPLICATION_NAMED_TABLES in temporal/scripts/lint-ontology.ts if intentional.`,
      });
    }

    if (tableName === 'entity_facts') {
      const vt = findValueColumnType(tableBody);
      if (vt === null) {
        violations.push({ rule: 'rule1', file, detail: 'entity_facts.value column not declared in CREATE TABLE.' });
      } else if (!NUMERIC_TYPES.has(vt)) {
        violations.push({ rule: 'rule1', file, detail: `entity_facts.value declared as '${vt}'; must be a numeric type.` });
      }
    }
  }
  return violations;
}

const INSERT_FACT_KEY_COLS_RE = /insert\s+into\s+fact_types\s*\(([^)]*)\)/gi;
const QUOTED_STRING_RE = /'((?:[^']|'')*)'/g;
const FACT_KEY_REF_RE = /select\s+id\s+from\s+fact_types\s+where\s+key\s*=\s*'([^']+)'/gi;

function registeredFactTypeKeys(sql: string): Set<string> {
  const keys = new Set<string>();
  let cm: RegExpExecArray | null;
  INSERT_FACT_KEY_COLS_RE.lastIndex = 0;
  while ((cm = INSERT_FACT_KEY_COLS_RE.exec(sql)) !== null) {
    const cols = cm[1].split(',').map((c) => c.trim().toLowerCase());
    const keyIndex = cols.indexOf('key');
    if (keyIndex === -1) continue;
    const rest = sql.slice(cm.index + cm[0].length);
    const valuesMatch = rest.match(/values\s*([\s\S]+?);/i);
    if (!valuesMatch) continue;
    const tuples = valuesMatch[1].match(/\(([^)]*)\)/g) ?? [];
    for (const tup of tuples) {
      const inner = tup.slice(1, -1);
      const literals: string[] = [];
      let qm: RegExpExecArray | null;
      QUOTED_STRING_RE.lastIndex = 0;
      while ((qm = QUOTED_STRING_RE.exec(inner)) !== null) literals.push(qm[1].replace(/''/g, "'"));
      if (keyIndex < literals.length) keys.add(literals[keyIndex]);
    }
  }
  return keys;
}

function scanFactTypeReferences(files: string[]): Violation[] {
  const violations: Violation[] = [];
  const knownKeys = new Set<string>();
  for (const file of files) {
    const sql = stripComments(readFileSync(file, 'utf8'));
    const registeredHere = registeredFactTypeKeys(sql);
    const candidates = new Set([...knownKeys, ...registeredHere]);
    let m: RegExpExecArray | null;
    FACT_KEY_REF_RE.lastIndex = 0;
    while ((m = FACT_KEY_REF_RE.exec(sql)) !== null) {
      if (!candidates.has(m[1])) {
        violations.push({
          rule: 'rule2',
          file,
          detail: `References fact_type key '${m[1]}' not inserted in this or any earlier migration.`,
        });
      }
    }
    for (const k of registeredHere) knownKeys.add(k);
  }
  return violations;
}

// ---------------------------------------------------------------------------
// File gathering
// ---------------------------------------------------------------------------

function gatherSqlFiles(roots: string[]): string[] {
  const files: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const stat = statSync(root);
    if (stat.isFile() && extname(root) === '.sql') {
      files.push(root);
    } else if (stat.isDirectory()) {
      for (const entry of readdirSync(root).sort()) {
        const full = join(root, entry);
        if (extname(entry) === '.sql' && statSync(full).isFile()) files.push(full);
      }
    }
  }
  return [...new Set(files)].sort();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function lint(files: string[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    const sql = stripComments(readFileSync(file, 'utf8'));
    violations.push(...scanCreateTables(sql, file));
  }
  violations.push(...scanFactTypeReferences(files));
  return violations;
}

function main(argv: string[]): number {
  const repoRoot = resolve(__dirname, '..', '..');
  const targets = argv.length > 0
    ? argv.map((a) => resolve(a))
    : [
        join(repoRoot, 'supabase', 'migrations'),
        join(repoRoot, 'supabase', 'seed.sql'),
      ];

  const files = gatherSqlFiles(targets);
  if (files.length === 0) {
    console.log('ontology-lint: no SQL files found; nothing to do');
    return 0;
  }

  const violations = lint(files);
  if (violations.length === 0) {
    console.log(`ontology-lint: OK (${files.length} file(s) scanned, 0 violations)`);
    return 0;
  }

  console.error(`ontology-lint: ${violations.length} violation(s) across ${files.length} file(s)`);
  for (const v of violations) console.error(`  ${fmtViolation(v)}`);
  return 1;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
