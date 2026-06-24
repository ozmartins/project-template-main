#!/usr/bin/env node
// Aggregate static-analysis tool outputs into a single `quality` object for the
// ci-history `quality` record (sibling of coverage-compute.mjs). Dependency-free.
//
// The workflow runs each tool with a machine-readable formatter and drops the output
// into a results dir; this reads whatever is present and degrades gracefully (a missing
// tool → null, never a crash). Counts are what the renderer/targets/scorecard consume.
//
// Usage: node quality-compute.mjs --dir <results-dir>
// Reads (all optional): tsc.txt, eslint.json, ruff.json, shellcheck.json, hadolint.json,
//   gitleaks.json, semgrep.json, trivy.json, npm-audit.json, pip-audit.json, codeql.json
// Emits the quality object (pretty JSON) to stdout.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const DIR = arg('dir', '.');

function readJson(name) {
  const p = join(DIR, name);
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return undefined;
  }
}
function readText(name) {
  const p = join(DIR, name);
  return existsSync(p) ? readFileSync(p, 'utf8') : undefined;
}
const sev = () => ({ critical: 0, high: 0, medium: 0, low: 0 });

// --- tsc: text output, count "error TS####" lines ---
function tscErrors() {
  const t = readText('tsc.txt');
  if (t === undefined) return null;
  return (t.match(/error TS\d+/g) || []).length;
}

// --- eslint -f json: array of files each with errorCount/warningCount ---
function eslintCounts() {
  const j = readJson('eslint.json');
  if (!Array.isArray(j)) return null;
  return j.reduce(
    (a, f) => ({ errors: a.errors + (f.errorCount || 0), warnings: a.warnings + (f.warningCount || 0) }),
    { errors: 0, warnings: 0 },
  );
}

// --- ruff/shellcheck/hadolint: arrays of findings ---
function arrLen(name) {
  const j = readJson(name);
  return Array.isArray(j) ? j.length : null;
}

// --- gitleaks --report-format json: array of leaks ---
function gitleaksCount() {
  const j = readJson('gitleaks.json');
  if (j === undefined) return null;
  return Array.isArray(j) ? j.length : 0;
}

// --- semgrep --json: { results:[{extra:{severity}}] } (ERROR/WARNING/INFO) ---
function semgrep() {
  const j = readJson('semgrep.json');
  if (!j || !Array.isArray(j.results)) return null;
  const s = sev();
  for (const r of j.results) {
    const v = String(r.extra?.severity || '').toUpperCase();
    if (v === 'ERROR') s.high++;
    else if (v === 'WARNING') s.medium++;
    else s.low++;
  }
  s.total = j.results.length;
  return s;
}

// --- trivy fs --format json: { Results:[{ Vulnerabilities:[{Severity}] }] } ---
function trivy() {
  const j = readJson('trivy.json');
  if (!j || !Array.isArray(j.Results)) return null;
  const s = sev();
  for (const res of j.Results) {
    for (const v of res.Vulnerabilities || []) {
      const k = String(v.Severity || '').toLowerCase();
      if (k in s) s[k]++;
    }
  }
  return s;
}

// --- npm audit --json: { metadata:{ vulnerabilities:{critical,high,moderate,low} } } ---
function npmAudit() {
  const j = readJson('npm-audit.json');
  const v = j?.metadata?.vulnerabilities;
  if (!v) return null;
  return { critical: v.critical || 0, high: v.high || 0, medium: v.moderate || 0, low: v.low || 0 };
}

// --- pip-audit -f json: { dependencies:[{ vulns:[...] }] } or [{vulns}] ---
function pipAudit() {
  const j = readJson('pip-audit.json');
  if (!j) return null;
  const deps = Array.isArray(j) ? j : j.dependencies || [];
  let count = 0;
  for (const d of deps) count += (d.vulns || []).length;
  return { vulns: count };
}

// --- codeql.json: array of open code-scanning alerts (from `gh api`) ---
// Each alert has rule.security_severity_level (critical/high/medium/low) or rule.severity.
function codeql() {
  const j = readJson('codeql.json');
  if (!Array.isArray(j)) return null;
  const s = sev();
  for (const a of j) {
    const lvl = String(a.rule?.security_severity_level || a.rule?.severity || 'low').toLowerCase();
    if (lvl in s) s[lvl]++;
    else if (lvl === 'error') s.high++;
    else if (lvl === 'warning') s.medium++;
    else s.low++;
  }
  s.total = j.length;
  return s;
}

// Roll dependency scanners up into one "deps" severity view for targets/scorecard.
function depsRollup(npm, pip, trivyVulns) {
  if (!npm && !pip && !trivyVulns) return null;
  const s = sev();
  for (const src of [npm, trivyVulns]) {
    if (!src) continue;
    s.critical += src.critical || 0;
    s.high += src.high || 0;
    s.medium += src.medium || 0;
    s.low += src.low || 0;
  }
  if (pip?.vulns) s.high += pip.vulns; // pip-audit doesn't grade severity → treat as high
  return s;
}

const npm = npmAudit();
const pip = pipAudit();
const trivyVulns = trivy();
const sast = semgrep();
const cq = codeql();

const out = {
  ts_errors: tscErrors(),
  eslint: eslintCounts(),
  ruff: arrLen('ruff.json'),
  shellcheck: arrLen('shellcheck.json'),
  hadolint: arrLen('hadolint.json'),
  secrets: gitleaksCount(),
  semgrep: sast,
  codeql: cq,
  deps: depsRollup(npm, pip, trivyVulns),
  deps_detail: { npm, pip, trivy: trivyVulns },
  // Headline rollups the scorecard keys on:
  sast_critical: (sast?.critical || 0) + (cq?.critical || 0),
  sast_high: (sast?.high || 0) + (cq?.high || 0),
  deps_critical: (npm?.critical || 0) + (trivyVulns?.critical || 0),
  deps_high: (npm?.high || 0) + (trivyVulns?.high || 0) + (pip?.vulns || 0),
};

process.stdout.write(JSON.stringify(out, null, 2) + '\n');
