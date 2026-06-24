// Shared, dependency-free helpers for the history renderers: load the QA SLO targets,
// compute breach flags, skip-rate, and a richer flakiness signal (flip-flops, not just
// raw fail counts). Imported by test-history-render.mjs and e2e-history-render.mjs.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// qa-targets.json lives at .github/qa-targets.json, one level up from .github/scripts/.
// Resolve relative to THIS module so cwd (the history-branch dir) doesn't matter.
export function loadTargets() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '..', 'qa-targets.json');
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null; // renderers degrade gracefully — no targets section
  }
}

export const flag = (ok) => (ok === null || ok === undefined ? '—' : ok ? '✅' : '⚠️');
export const pctStr = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);

// Skip-rate for a single run record: skipped / total. Rising skip% = hidden coverage loss.
export function skipPct(r) {
  const t = r?.stats?.total ?? 0;
  return t > 0 ? (r.stats.skipped ?? 0) / t : null;
}

// Mean skip-rate across a set of run records (weighted by total tests).
export function meanSkipPct(rows) {
  let sk = 0;
  let tot = 0;
  for (const r of rows) {
    sk += r?.stats?.skipped ?? 0;
    tot += r?.stats?.total ?? 0;
  }
  return tot > 0 ? sk / tot : null;
}

// Per-test flakiness over a window. "flips" = pass<->fail/flaky transitions across
// consecutive runs of that test (a test that alternates every run is maximally flaky,
// even if its raw fail count is modest). Returns rows sorted worst-first.
export function flakiness(rows, { key = (r, t) => `${r.suite}::${t.title}` } = {}) {
  const agg = new Map();
  for (const r of rows) {
    for (const t of r.tests || []) {
      const k = key(r, t);
      const a =
        agg.get(k) ||
        { title: t.title, suite: r.suite, runs: 0, fails: 0, flakies: 0, flips: 0, seq: [], last: t.status, lastTs: r.ts };
      a.runs++;
      if (t.status === 'failed') a.fails++;
      if (t.status === 'flaky') a.flakies++;
      a.seq.push({ ts: r.ts, status: t.status });
      if (!a.lastTs || String(r.ts) >= String(a.lastTs)) {
        a.last = t.status;
        a.lastTs = r.ts;
        a.suite = r.suite;
      }
      agg.set(k, a);
    }
  }
  const norm = (s) => (s === 'passed' || s === 'skipped' ? 'ok' : 'bad'); // flaky counts as bad-ish for flips
  for (const a of agg.values()) {
    a.seq.sort((x, y) => String(x.ts).localeCompare(String(y.ts)));
    let flips = 0;
    for (let i = 1; i < a.seq.length; i++) {
      if (a.seq[i].status === 'skipped') continue;
      if (norm(a.seq[i].status) !== norm(a.seq[i - 1].status)) flips++;
    }
    a.flips = flips;
    a.flake_rate = a.runs > 0 ? (a.fails + a.flakies) / a.runs : 0;
    delete a.seq;
  }
  return [...agg.values()]
    .filter((a) => a.fails > 0 || a.flakies > 0)
    .sort((x, y) => y.flips - x.flips || y.fails + y.flakies - (x.fails + x.flakies));
}

// Count tests considered "unstable" in the window (any fail or flaky).
export function unstableCount(rows) {
  return flakiness(rows).length;
}
