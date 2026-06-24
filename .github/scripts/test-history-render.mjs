#!/usr/bin/env node
// Render the human-facing CI test dashboard from runs.jsonl on the ci-history branch.
//
// Sibling of e2e-history-render.mjs, but suite-agnostic: it discovers every `suite`
// present in the feed (unit, temporal, helm, seed, ...) and charts them together so
// you can see where each test suite is at build-over-build.
//
// Reads the append-only history feed and writes, alongside it:
//   - trend.svg   a dependency-free pass-rate trend (one line per suite)
//   - README.md   a per-suite status table + recent runs + unstable tests, renders in GitHub's UI
//
// Usage: node test-history-render.mjs <history-dir>   (defaults to cwd)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] || '.';
const feed = join(dir, 'runs.jsonl');

const rows = existsSync(feed)
  ? readFileSync(feed, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
  : [];

// Stable chronological order (the feed is append-only, but be defensive).
rows.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));

// Discover suites in first-seen order; assign each a stable color.
const PALETTE = ['#1f883d', '#0969da', '#bf8700', '#8250df', '#cf222e', '#1b7c83', '#9a6700', '#bc4c00'];
const suiteOrder = [];
for (const r of rows) if (r.suite && !suiteOrder.includes(r.suite)) suiteOrder.push(r.suite);
const colorOf = (s) => PALETTE[suiteOrder.indexOf(s) % PALETTE.length];
const bySuite = (s) => rows.filter((r) => r.suite === s);

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ----------------------------------------------------------------------------- SVG
const W = 920;
const PAD = { l: 56, r: 150, t: 28, b: 40 };
const PANEL_H = 200;
const H = PAD.t + PANEL_H + PAD.b;
const PLOT_W = W - PAD.l - PAD.r;

const TITLE_ATTR = 'font-size="12" font-weight="600" fill="#1f2328"';
const YLAB_ATTR = 'font-size="10" fill="#656d76" text-anchor="end"';
const GRID_ATTR = 'stroke="#e1e4e8" stroke-width="1"';
const LEGEND_ATTR = 'font-size="11" fill="#1f2328"';

function linePath(points) {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
}

function buildSvg() {
  const N = 60; // last N runs per suite
  const top = PAD.t;
  const yMin = 0;
  const yMax = 100;
  const y = (v) => top + PANEL_H - ((v - yMin) / (yMax - yMin || 1)) * PANEL_H;

  let body = `<text x="${PAD.l}" y="${top - 10}" ${TITLE_ATTR}>Pass rate by suite (last ${N} runs) — red dot = failing/errored run</text>`;
  // gridlines + y labels
  for (let g = 0; g <= 4; g++) {
    const v = yMin + ((yMax - yMin) * g) / 4;
    const yy = y(v);
    body += `<line x1="${PAD.l}" y1="${yy.toFixed(1)}" x2="${PAD.l + PLOT_W}" y2="${yy.toFixed(1)}" ${GRID_ATTR}/>`;
    body += `<text x="${PAD.l - 8}" y="${(yy + 3).toFixed(1)}" ${YLAB_ATTR}>${Math.round(v)}%</text>`;
  }

  let legendY = top + 4;
  if (!suiteOrder.length) {
    body += `<text x="${PAD.l}" y="${top + 90}" font-size="13" fill="#8b949e">no data yet</text>`;
  }
  for (const suite of suiteOrder) {
    const runs = bySuite(suite).slice(-N);
    if (!runs.length) continue;
    const color = colorOf(suite);
    const x = (i, n) => PAD.l + (n <= 1 ? PLOT_W / 2 : (PLOT_W * i) / (n - 1));
    const pts = runs.map((r, i) => [x(i, runs.length), y((r.pass_rate ?? 0) * 100)]);
    if (pts.length === 1) {
      body += `<circle cx="${pts[0][0].toFixed(1)}" cy="${pts[0][1].toFixed(1)}" r="3" fill="${color}"/>`;
    } else {
      body += `<path d="${linePath(pts)}" fill="none" stroke="${color}" stroke-width="2"/>`;
    }
    runs.forEach((r, i) => {
      if (r.outcome !== 'passed') body += `<circle cx="${pts[i][0].toFixed(1)}" cy="${pts[i][1].toFixed(1)}" r="2.6" fill="#d1242f"/>`;
    });
    // legend entry
    body += `<rect x="${PAD.l + PLOT_W + 16}" y="${legendY - 9}" width="11" height="11" rx="2" fill="${color}"/>`;
    body += `<text x="${PAD.l + PLOT_W + 32}" y="${legendY}" ${LEGEND_ATTR}>${esc(suite)}</text>`;
    legendY += 20;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
<rect width="${W}" height="${H}" fill="#ffffff"/>
${body}
</svg>`;
}

// --------------------------------------------------------------------------- README
function fmtTs(ts) {
  if (!ts) return '—';
  return ts.replace('T', ' ').replace(/:\d\d\.\d+Z$/, 'Z').replace(/\.\d+Z$/, 'Z');
}
const ICON = { passed: '✅', failed: '❌', error: '🟠' };

function streak(suiteRows) {
  let n = 0;
  for (let i = suiteRows.length - 1; i >= 0; i--) {
    if (suiteRows[i].outcome === 'passed') n++;
    else break;
  }
  return n;
}

function passRateOver(suiteRows, sinceMs) {
  const cut = rows.length ? Date.parse(rows[rows.length - 1].ts || '') - sinceMs : 0;
  const win = suiteRows.filter((r) => Date.parse(r.ts || '') >= cut);
  const passed = win.filter((r) => r.outcome === 'passed').length;
  return win.length ? { pct: Math.round((passed / win.length) * 100), n: win.length } : { pct: null, n: 0 };
}

function suiteSummaryTable() {
  let t = '| Suite | Latest | When (UTC) | Pass 24h | Pass 7d | Green streak | Runs |\n';
  t += '|---|---|---|--:|--:|--:|--:|\n';
  for (const suite of suiteOrder) {
    const sr = bySuite(suite);
    const latest = sr[sr.length - 1];
    const day = passRateOver(sr, 24 * 3600e3);
    const week = passRateOver(sr, 7 * 24 * 3600e3);
    const latestCell = latest
      ? `${ICON[latest.outcome] || ''} \`${latest.outcome}\`${latest.run_url ? ` [↗](${latest.run_url})` : ''}`
      : '—';
    t += `| \`${suite}\` | ${latestCell} | ${fmtTs(latest?.ts)} | ${day.pct == null ? '—' : `${day.pct}% (${day.n})`} | ${week.pct == null ? '—' : `${week.pct}% (${week.n})`} | ${streak(sr)} | ${sr.length} |\n`;
  }
  return t;
}

function recentRunsTable() {
  const last = rows.slice(-20).reverse();
  let t = '| When (UTC) | Suite | Result | Pass | Fail | Skip | Duration | Commit | Run |\n';
  t += '|---|---|---|--:|--:|--:|--:|---|---|\n';
  for (const r of last) {
    const dur = r.stats?.duration_ms != null ? `${(r.stats.duration_ms / 1000).toFixed(1)}s` : '—';
    const commit = r.sha_short ? `\`${r.sha_short}\`` : '—';
    const run = r.run_url ? `[#${r.run_number ?? '↗'}](${r.run_url})` : '—';
    t += `| ${fmtTs(r.ts)} | \`${r.suite}\` | ${ICON[r.outcome] || ''} ${r.outcome} | ${r.stats?.expected ?? 0} | ${r.stats?.unexpected ?? 0} | ${r.stats?.skipped ?? 0} | ${dur} | ${commit} | ${run} |\n`;
  }
  return t;
}

function unstableTestsTable() {
  const window = rows.slice(-120);
  const agg = new Map();
  for (const r of window) {
    for (const t of r.tests || []) {
      const key = `${r.suite}::${t.title}`;
      const a = agg.get(key) || { title: t.title, suite: r.suite, fails: 0, flakies: 0, runs: 0, last: t.status, lastTs: r.ts };
      a.runs++;
      if (t.status === 'failed') a.fails++;
      if (t.status === 'flaky') a.flakies++;
      if (!a.lastTs || String(r.ts) >= String(a.lastTs)) {
        a.last = t.status;
        a.lastTs = r.ts;
      }
      agg.set(key, a);
    }
  }
  const unstable = [...agg.values()]
    .filter((a) => a.fails > 0 || a.flakies > 0)
    .sort((x, y) => y.fails + y.flakies - (x.fails + x.flakies))
    .slice(0, 20);
  if (!unstable.length) return '_No failing or flaky tests in the recent window. 🎉_\n';
  let t = '| Test | Suite | Fails | Flakies | Last |\n|---|---|--:|--:|---|\n';
  for (const a of unstable) {
    t += `| ${a.title.replace(/\|/g, '\\|')} | \`${a.suite}\` | ${a.fails} | ${a.flakies} | ${ICON[a.last] || a.last} |\n`;
  }
  return t;
}

function buildReadme() {
  const latestAny = rows[rows.length - 1];
  return `# CI test trends — \`${esc(process.env.GITHUB_REPOSITORY || 'this repo')}\`

> Auto-generated by **PR Validation** (\`publish-test-history\`). Do not edit by hand — every
> run regenerates this branch. The machine-readable source of truth is [\`runs.jsonl\`](./runs.jsonl).
> Deployed-environment E2E trends live separately on the [\`e2e-history\`](../../tree/e2e-history) branch.

**Last updated:** ${fmtTs(latestAny?.ts)} · ${rows.length} records · suites: ${suiteOrder.map((s) => `\`${s}\``).join(', ') || '—'}

![trend](./trend.svg)

## Suites

${suiteSummaryTable()}

## Recent runs

${recentRunsTable()}

## Unstable tests (recent window)

${unstableTestsTable()}

---

### Reading this data programmatically

\`\`\`bash
# every line is one suite-run; newest last
git show ci-history:runs.jsonl | tail -n 20

# e.g. the unit suite's pass-rate over its last 50 runs
git show ci-history:runs.jsonl \\
  | jq -rs '[.[] | select(.suite=="unit")] | .[-50:]
            | (map(select(.outcome=="passed")) | length) / length * 100'
\`\`\`

Record shape: \`{ ts, suite, outcome, pass_rate, stats:{expected,unexpected,flaky,skipped,total,duration_ms}, run_url, sha_short, branch, trigger, tests:[{title,file,status,duration_ms}] }\`
`;
}

writeFileSync(join(dir, 'trend.svg'), buildSvg());
writeFileSync(join(dir, 'README.md'), buildReadme());
console.log(`rendered CI dashboard from ${rows.length} record(s) across ${suiteOrder.length} suite(s)`);
