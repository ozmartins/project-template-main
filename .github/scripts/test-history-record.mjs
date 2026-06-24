#!/usr/bin/env node
// Convert a test runner's machine-readable report into a single append-only
// history record (one JSON line) on the `ci-history` branch.
//
// This is the multi-runner sibling of e2e-history-record.mjs: it normalizes the
// output of Playwright, Vitest, pytest (pytest-json-report) and shell suites into
// the SAME record schema, so one render script can chart every suite build-over-build.
//
// Usage:
//   node test-history-record.mjs --suite unit     --format vitest      --results vitest-results.json
//   node test-history-record.mjs --suite temporal --format pytest-json --results pytest-report.json
//   node test-history-record.mjs --suite helm     --format generic     --results helm-summary.json
//   node test-history-record.mjs --suite seed     --format generic     --outcome passed --duration-ms 41000
//
// Run metadata is read from the GitHub Actions environment (GITHUB_*). The emitted
// line is appended to runs.jsonl on the ci-history branch; it is the machine-readable
// source of truth that the render step and any agent reads back.
//
// Record schema (identical to e2e-history-record.mjs):
//   { ts, suite, outcome, pass_rate,
//     stats:{ expected, unexpected, flaky, skipped, total, duration_ms },
//     run_id, run_number, run_url, sha, sha_short, branch, trigger, base_url,
//     tests:[ { title, file, status, duration_ms } ] }
//
// Status vocabulary (normalized): passed | failed | flaky | skipped.
// outcome:  "error"  -> we never got a parseable report (infra/setup blew up)
//           "failed" -> at least one test was unexpected (failed)
//           "passed" -> everything green

import { readFileSync } from 'node:fs';

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const suite = arg('suite', 'unknown');
const format = arg('format', 'playwright');
const resultsPath = arg('results');

// ---------------------------------------------------------------- per-format adapters
// Each adapter returns { stats:{expected,unexpected,flaky,skipped,duration_ms}, tests:[...], ts }
// from a parsed report object. They are intentionally defensive: any missing field
// degrades to 0 / null rather than throwing, so a malformed report still yields a
// record (with outcome derived from whatever counts we recovered).

// Playwright `json` reporter (same shape e2e-history-record.mjs consumes).
function fromPlaywright(report) {
  const STATUS = { expected: 'passed', unexpected: 'failed', flaky: 'flaky', skipped: 'skipped' };
  const tests = [];
  const walk = (node, file) => {
    const f = node.file || file;
    (node.suites || []).forEach((s) => walk(s, f));
    (node.specs || []).forEach((spec) => {
      (spec.tests || []).forEach((t) => {
        const durationMs = (t.results || []).reduce((a, r) => a + (r.duration || 0), 0);
        tests.push({
          title: spec.title,
          file: f || spec.file || null,
          status: STATUS[t.status] || t.status || 'unknown',
          duration_ms: durationMs,
        });
      });
    });
  };
  (report.suites || []).forEach((s) => walk(s, null));
  const s = report.stats || {};
  return {
    stats: {
      expected: s.expected ?? 0,
      unexpected: s.unexpected ?? 0,
      flaky: s.flaky ?? 0,
      skipped: s.skipped ?? 0,
      duration_ms: s.duration ?? null,
    },
    tests,
    ts: s.startTime ? new Date(s.startTime).toISOString() : null,
  };
}

// Vitest/Jest `json` reporter: { numPassedTests, numFailedTests, numPendingTests,
//   numTodoTests, startTime, testResults:[{ name, assertionResults:[{ title, fullName,
//   status:'passed'|'failed'|'pending'|'skipped'|'todo', duration }] }] }
function fromVitest(report) {
  const MAP = { passed: 'passed', failed: 'failed', pending: 'skipped', skipped: 'skipped', todo: 'skipped' };
  const tests = [];
  let durationMs = 0;
  for (const file of report.testResults || []) {
    for (const a of file.assertionResults || []) {
      const d = a.duration ?? 0;
      durationMs += d;
      tests.push({
        title: a.fullName || a.title || '(unnamed)',
        file: file.name || null,
        status: MAP[a.status] || a.status || 'unknown',
        duration_ms: Math.round(d),
      });
    }
  }
  const expected = report.numPassedTests ?? 0;
  const unexpected = report.numFailedTests ?? 0;
  const skipped = (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0);
  return {
    stats: { expected, unexpected, flaky: 0, skipped, duration_ms: durationMs || null },
    tests,
    ts: report.startTime ? new Date(report.startTime).toISOString() : null,
  };
}

// pytest-json-report (`--json-report`): { created, duration,
//   summary:{ passed, failed, error, skipped, total }, tests:[{ nodeid, outcome, ... }] }
function fromPytestJson(report) {
  const MAP = { passed: 'passed', failed: 'failed', error: 'failed', skipped: 'skipped', xfailed: 'skipped', xpassed: 'passed' };
  const tests = (report.tests || []).map((t) => ({
    title: t.nodeid || '(unnamed)',
    file: (t.nodeid || '').split('::')[0] || null,
    status: MAP[t.outcome] || t.outcome || 'unknown',
    duration_ms: Math.round(
      ((t.setup?.duration || 0) + (t.call?.duration || 0) + (t.teardown?.duration || 0)) * 1000
    ),
  }));
  const sum = report.summary || {};
  const expected = sum.passed ?? 0;
  const unexpected = (sum.failed ?? 0) + (sum.error ?? 0);
  const skipped = sum.skipped ?? 0;
  // pytest exit codes: 0 ok · 1 tests failed · 2 interrupted/collection error ·
  // 3 internal error · 4 usage error · 5 no tests collected. A collection/internal
  // error produces NO failed/error counts in `summary`, so without this backstop an
  // errored run would be mis-recorded as a green/empty pass. Force the real outcome.
  let forcedOutcome;
  if ([2, 3, 4].includes(report.exitcode)) forcedOutcome = 'error';
  else if (report.exitcode === 1 && unexpected === 0) forcedOutcome = 'failed';
  return {
    stats: {
      expected,
      unexpected,
      flaky: 0,
      skipped,
      duration_ms: report.duration != null ? Math.round(report.duration * 1000) : null,
    },
    tests,
    ts: report.created ? new Date(report.created * 1000).toISOString() : null,
    forcedOutcome,
  };
}

// Generic: for shell suites with no native machine report. Either:
//   (a) point --results at a JSON file shaped { outcome?, expected?, unexpected?,
//       flaky?, skipped?, duration_ms?, tests?[] }, or
//   (b) pass --outcome passed|failed (+ optional --expected/--unexpected/--duration-ms)
//       and we synthesize a single coarse pass/fail record.
function fromGeneric(report) {
  const r = report || {};
  const numFlag = (name, fallback) => {
    const v = arg(name);
    return v != null ? Number(v) : r[name.replace(/-/g, '_')] ?? fallback;
  };
  const outcomeFlag = arg('outcome') || r.outcome || null;
  let expected = numFlag('expected', undefined);
  let unexpected = numFlag('unexpected', undefined);
  // If neither count was supplied, derive a 1/0 pass/fail from the outcome.
  if (expected == null && unexpected == null) {
    expected = outcomeFlag === 'passed' ? 1 : 0;
    unexpected = outcomeFlag === 'failed' ? 1 : 0;
  }
  return {
    stats: {
      expected: expected ?? 0,
      unexpected: unexpected ?? 0,
      flaky: numFlag('flaky', 0) ?? 0,
      skipped: numFlag('skipped', 0) ?? 0,
      duration_ms: numFlag('duration-ms', r.duration_ms ?? null) ?? null,
    },
    tests: Array.isArray(r.tests) ? r.tests : [],
    ts: r.ts || null,
    forcedOutcome: outcomeFlag, // honored below when no counts disambiguate
  };
}

const ADAPTERS = {
  playwright: fromPlaywright,
  vitest: fromVitest,
  'pytest-json': fromPytestJson,
  generic: fromGeneric,
};

const REPORT_START_MARKERS = {
  vitest: ['numFailedTestSuites', 'numTotalTests', 'numPassedTests', 'testResults'],
  'pytest-json': ['created', 'duration', 'summary', 'tests'],
};

function isLikelyReportForFormat(candidate, formatName) {
  // CI reports must be top-level objects; arrays indicate we matched the wrong JSON segment.
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
  if (formatName === 'vitest') {
    return (
      Object.prototype.hasOwnProperty.call(candidate, 'numPassedTests') ||
      Object.prototype.hasOwnProperty.call(candidate, 'numFailedTests') ||
      Array.isArray(candidate.testResults)
    );
  }
  if (formatName === 'pytest-json') {
    return (
      Object.prototype.hasOwnProperty.call(candidate, 'summary') ||
      Array.isArray(candidate.tests) ||
      Object.prototype.hasOwnProperty.call(candidate, 'exitcode')
    );
  }
  return true;
}

function errorMessage(error) {
  return String(error && error.message ? error.message : error);
}

function findLikelyJsonStart(rawReport, formatName) {
  const markers = REPORT_START_MARKERS[formatName] || [];
  for (const marker of markers) {
    const markerIndex = rawReport.indexOf(marker);
    if (markerIndex !== -1) {
      const objectStart = rawReport.lastIndexOf('{', markerIndex);
      if (objectStart !== -1) return objectStart;
    }
  }
  return -1;
}

function tryParseJson(rawText) {
  try {
    return { value: JSON.parse(rawText), parseError: null };
  } catch (parseFailure) {
    return { value: null, parseError: parseFailure };
  }
}

function parseReportWithRecovery(rawReport, formatName) {
  const initial = tryParseJson(rawReport);
  if (initial.value != null) {
    return { report: initial.value, parseError: null };
  }

  const jsonStart = findLikelyJsonStart(rawReport, formatName);
  if (jsonStart === -1) {
    return {
      report: null,
      parseError: errorMessage(initial.parseError),
    };
  }

  const recovered = tryParseJson(rawReport.slice(jsonStart));
  if (recovered.value == null) {
    return {
      report: null,
      parseError: errorMessage(recovered.parseError),
    };
  }
  if (!isLikelyReportForFormat(recovered.value, formatName)) {
    return {
      report: null,
      parseError: errorMessage(initial.parseError),
    };
  }
  return { report: recovered.value, parseError: null };
}

// ----------------------------------------------------------------------------- parse
let report = null;
let parseError = null;
if (resultsPath) {
  const rawReport = readFileSync(resultsPath, 'utf8');
  ({ report, parseError } = parseReportWithRecovery(rawReport, format));
}
// The generic format can run without a file (flags only); every other format needs one.
const needsFile = format !== 'generic';

const adapter = ADAPTERS[format];
if (!adapter) {
  process.stderr.write(`unknown --format "${format}" (expected: ${Object.keys(ADAPTERS).join(', ')})\n`);
  process.exit(2);
}

let parsed = null;
if (report != null || format === 'generic') {
  try {
    parsed = adapter(report || {});
  } catch (e) {
    parseError = parseError || String(e && e.message ? e.message : e);
  }
}

const stats = (parsed && parsed.stats) || {};
const expected = stats.expected ?? 0;
const unexpected = stats.unexpected ?? 0;
const flaky = stats.flaky ?? 0;
const skipped = stats.skipped ?? 0;
const total = expected + unexpected + flaky + skipped;

// outcome: "error" when we expected a report and never got a parseable one
// (infra/setup blew up); "failed" when any test was unexpected; otherwise "passed".
let outcome;
if (needsFile && report == null) {
  outcome = 'error';
} else if (parsed && parsed.forcedOutcome === 'error') {
  outcome = 'error';
} else {
  outcome = unexpected > 0 ? 'failed' : parsed?.forcedOutcome === 'failed' ? 'failed' : 'passed';
}

// pass_rate counts only deterministic results (passed+failed+flaky-on-retry);
// skipped tests are excluded from the denominator.
const denom = expected + unexpected + flaky;
const passRate = denom > 0 ? (expected + flaky) / denom : null;

const ts = (parsed && parsed.ts) || process.env.RUN_TS || null;
const sha = process.env.GITHUB_SHA || null;
const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
const repo = process.env.GITHUB_REPOSITORY || '';
const runId = process.env.GITHUB_RUN_ID || null;

const record = {
  ts,
  suite,
  outcome,
  pass_rate: passRate,
  stats: { expected, unexpected, flaky, skipped, total, duration_ms: stats.duration_ms ?? null },
  run_id: runId,
  run_number: process.env.GITHUB_RUN_NUMBER || null,
  run_url: runId && repo ? `${serverUrl}/${repo}/actions/runs/${runId}` : null,
  sha,
  sha_short: sha ? sha.slice(0, 7) : null,
  branch: process.env.GITHUB_REF_NAME || null,
  trigger: process.env.GITHUB_EVENT_NAME || null,
  base_url: null, // CI suites run against the build, not a deployed URL
  tests: (parsed && parsed.tests) || [],
};
if (parseError) record.error = parseError;

process.stdout.write(JSON.stringify(record) + '\n');
