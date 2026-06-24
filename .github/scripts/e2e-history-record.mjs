#!/usr/bin/env node
// Convert a Playwright JSON report into a single append-only history record (one JSON line).
//
// Usage:
//   node e2e-history-record.mjs --suite smoke --results path/to/e2e-results.json
//
// Run metadata is read from the GitHub Actions environment (GITHUB_*). The emitted
// line is appended to runs.jsonl on the e2e-history branch; it is the machine-readable
// source of truth that the render step and any agent reads back.

import { readFileSync } from 'node:fs';

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const suite = arg('suite', 'unknown');
const resultsPath = arg('results');

// Map Playwright's per-test status vocabulary onto ours.
//   expected -> passed, unexpected -> failed, flaky -> flaky, skipped -> skipped
const STATUS = { expected: 'passed', unexpected: 'failed', flaky: 'flaky', skipped: 'skipped' };

function flattenTests(report) {
  const out = [];
  const walk = (node, file) => {
    const f = node.file || file;
    (node.suites || []).forEach((s) => walk(s, f));
    (node.specs || []).forEach((spec) => {
      (spec.tests || []).forEach((t) => {
        const durationMs = (t.results || []).reduce((a, r) => a + (r.duration || 0), 0);
        out.push({
          title: spec.title,
          file: f || spec.file || null,
          status: STATUS[t.status] || t.status || 'unknown',
          duration_ms: durationMs,
        });
      });
    });
  };
  (report.suites || []).forEach((s) => walk(s, null));
  return out;
}

let report = null;
let parseError = null;
if (resultsPath) {
  try {
    report = JSON.parse(readFileSync(resultsPath, 'utf8'));
  } catch (e) {
    parseError = String(e && e.message ? e.message : e);
  }
}

const stats = (report && report.stats) || {};
const expected = stats.expected ?? 0;
const unexpected = stats.unexpected ?? 0;
const flaky = stats.flaky ?? 0;
const skipped = stats.skipped ?? 0;
const total = expected + unexpected + flaky + skipped;

// outcome: "error" when we never got a parseable report (infra/setup blew up),
// "failed" when any test was unexpected, otherwise "passed".
const outcome = report == null ? 'error' : unexpected > 0 ? 'failed' : 'passed';

// pass_rate counts only deterministic results (passed+failed); flaky tests passed on
// retry so they count toward the numerator, skipped tests are excluded entirely.
const denom = expected + unexpected + flaky;
const passRate = denom > 0 ? (expected + flaky) / denom : null;

const ts =
  (stats.startTime && new Date(stats.startTime).toISOString()) ||
  process.env.RUN_TS ||
  null;

const sha = process.env.GITHUB_SHA || null;
const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
const repo = process.env.GITHUB_REPOSITORY || '';
const runId = process.env.GITHUB_RUN_ID || null;

const record = {
  ts,
  suite,
  outcome,
  pass_rate: passRate,
  stats: { expected, unexpected, flaky, skipped, total, duration_ms: stats.duration ?? null },
  run_id: runId,
  run_number: process.env.GITHUB_RUN_NUMBER || null,
  run_url: runId && repo ? `${serverUrl}/${repo}/actions/runs/${runId}` : null,
  sha,
  sha_short: sha ? sha.slice(0, 7) : null,
  branch: process.env.GITHUB_REF_NAME || null,
  trigger: process.env.GITHUB_EVENT_NAME || null,
  base_url: process.env.E2E_BASE_URL || null,
  tests: report ? flattenTests(report) : [],
};
if (parseError) record.error = parseError;

process.stdout.write(JSON.stringify(record) + '\n');
