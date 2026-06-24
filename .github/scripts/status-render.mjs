#!/usr/bin/env node
// Render the unified CI & environment status dashboard.
//
// Reads ci-history and e2e-history append-only JSONL feeds and writes to an
// output directory:
//   - index.html   Chart.js interactive dashboard (data baked in, no runtime fetches)
//   - trend.svg    dependency-free pass-rate trend chart (for embedding in README.md)
//   - README.md    GitHub-renderable summary with SVG trend and text table
//
// Usage: node status-render.mjs [ci-history-dir] [e2e-history-dir] [output-dir]
//   Defaults: ci-history=./ci-history, e2e-history=./e2e-history, output-dir=./status-out

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [, , ciDir = './ci-history', e2eDir = './e2e-history', outDir = './status-out'] = process.argv;

// ─────────────────────────────────────────────── helpers ──────────────────────

function readFeed(dir) {
  const feed = join(dir, 'runs.jsonl');
  if (!existsSync(feed)) return [];
  return readFileSync(feed, 'utf8')
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
    .sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
}

const ciRows = readFeed(ciDir);
const e2eRows = readFeed(e2eDir);

// Tag source for disambiguation.
for (const r of ciRows) r._src = 'ci';
for (const r of e2eRows) r._src = 'e2e';

const allRows = [...ciRows, ...e2eRows].sort((a, b) =>
  String(a.ts || '').localeCompare(String(b.ts || ''))
);

// Discover suites in first-seen order (ci suites first, then e2e).
const PALETTE = ['#1f883d', '#0969da', '#bf8700', '#8250df', '#cf222e', '#1b7c83', '#9a6700', '#bc4c00'];
const suiteOrder = [];
for (const r of allRows) {
  if (r.suite && !suiteOrder.includes(r.suite)) suiteOrder.push(r.suite);
}
const colorOf = (s) => PALETTE[suiteOrder.indexOf(s) % PALETTE.length];
const bySuite = (s) => allRows.filter((r) => r.suite === s);

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function fmtTs(ts) {
  if (!ts) return '—';
  return ts.replace('T', ' ').replace(/:\d\d(\.\d+)?Z$/, 'Z');
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
  const anchor = allRows.length ? Date.parse(allRows[allRows.length - 1].ts || '') : Date.now();
  const cut = anchor - sinceMs;
  const win = suiteRows.filter((r) => Date.parse(r.ts || '') >= cut);
  const passed = win.filter((r) => r.outcome === 'passed').length;
  return win.length ? { pct: Math.round((passed / win.length) * 100), n: win.length } : { pct: null, n: 0 };
}

function trendArrow(suiteRows) {
  if (suiteRows.length < 4) return '→';
  const half = Math.floor(suiteRows.length / 2);
  const older = suiteRows.slice(-2 * half, -half);
  const newer = suiteRows.slice(-half);
  const rate = (rs) => rs.filter((r) => r.outcome === 'passed').length / rs.length;
  const diff = rate(newer) - rate(older);
  if (diff > 0.05) return '↑';
  if (diff < -0.05) return '↓';
  return '→';
}

// ─────────────────────────────────────────────── SVG trend ────────────────────

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
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
    .join(' ');
}

function buildSvg() {
  const N = 60;
  const top = PAD.t;
  const yMin = 0;
  const yMax = 100;
  const y = (v) => top + PANEL_H - ((v - yMin) / (yMax - yMin || 1)) * PANEL_H;

  let body = `<text x="${PAD.l}" y="${top - 10}" ${TITLE_ATTR}>Pass rate by suite (last ${N} runs each) — red dot = failing run</text>`;

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
      if (r.outcome !== 'passed')
        body += `<circle cx="${pts[i][0].toFixed(1)}" cy="${pts[i][1].toFixed(1)}" r="2.6" fill="#d1242f"/>`;
    });
    body += `<rect x="${PAD.l + PLOT_W + 16}" y="${legendY - 9}" width="11" height="11" rx="2" fill="${color}"/>`;
    body += `<text x="${PAD.l + PLOT_W + 32}" y="${legendY}" ${LEGEND_ATTR}>${esc(suite)}</text>`;
    legendY += 20;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
<rect width="${W}" height="${H}" fill="#ffffff"/>
${body}
</svg>`;
}

// ─────────────────────────────────────────────── README ───────────────────────

function suiteSummaryTable() {
  let t = '| Suite | Source | Latest | When (UTC) | Pass 24h | Pass 7d | Trend | Streak | Runs |\n';
  t += '|---|---|---|---|--:|--:|:---:|--:|--:|\n';
  for (const suite of suiteOrder) {
    const sr = bySuite(suite);
    const latest = sr[sr.length - 1];
    const src = latest?._src ?? '—';
    const day = passRateOver(sr, 24 * 3600e3);
    const week = passRateOver(sr, 7 * 24 * 3600e3);
    const latestCell = latest
      ? `${ICON[latest.outcome] || ''} \`${latest.outcome}\`${latest.run_url ? ` [↗](${latest.run_url})` : ''}`
      : '—';
    t += `| \`${suite}\` | ${src} | ${latestCell} | ${fmtTs(latest?.ts)} | ${day.pct == null ? '—' : `${day.pct}% (${day.n})`} | ${week.pct == null ? '—' : `${week.pct}% (${week.n})`} | ${trendArrow(sr)} | ${streak(sr)} | ${sr.length} |\n`;
  }
  return t;
}

function recentRunsTable() {
  const last = allRows.slice(-20).reverse();
  let t = '| When (UTC) | Suite | Source | Result | Pass | Fail | Duration | Commit | Run |\n';
  t += '|---|---|---|---|--:|--:|--:|---|---|\n';
  for (const r of last) {
    const dur = r.stats?.duration_ms != null ? `${(r.stats.duration_ms / 1000).toFixed(1)}s` : '—';
    const commit = r.sha_short ? `\`${r.sha_short}\`` : '—';
    const run = r.run_url ? `[#${r.run_number ?? '↗'}](${r.run_url})` : '—';
    t += `| ${fmtTs(r.ts)} | \`${r.suite}\` | ${r._src ?? '—'} | ${ICON[r.outcome] || ''} ${r.outcome} | ${r.stats?.expected ?? 0} | ${r.stats?.unexpected ?? 0} | ${dur} | ${commit} | ${run} |\n`;
  }
  return t;
}

function buildReadme() {
  const latestAny = allRows[allRows.length - 1];
  const repo = esc(process.env.GITHUB_REPOSITORY || 'this repo');
  return `# CI & environment status — \`${repo}\`

> Auto-generated by the **publish-status** pipeline stage. Do not edit by hand — every run
> regenerates this branch. Raw sources: [\`ci-history\`](../../tree/ci-history) (unit/temporal/helm tests)
> and [\`e2e-history\`](../../tree/e2e-history) (smoke/experience E2E).

**Last updated:** ${fmtTs(latestAny?.ts)} · ${allRows.length} total records · suites: ${suiteOrder.map((s) => `\`${s}\``).join(', ') || '—'}

![trend](./trend.svg)

## Suite summary

${suiteSummaryTable()}
## Recent runs (all suites)

${recentRunsTable()}
---

### Reading this data programmatically

\`\`\`bash
# CI test history (unit, temporal, helm, ...)
git show ci-history:runs.jsonl | tail -n 20

# E2E history (smoke, experience)
git show e2e-history:runs.jsonl | tail -n 20

# Example: smoke pass-rate over the last 50 runs
git show e2e-history:runs.jsonl \\
  | jq -rs '[.[] | select(.suite=="smoke")] | .[-50:]
  | (map(select(.outcome=="passed")) | length) / length * 100'
\`\`\`

Record shape: \`{ ts, suite, outcome, pass_rate, stats:{expected,unexpected,flaky,skipped,total,duration_ms}, run_url, sha_short, branch, trigger, tests:[...] }\`
`;
}

// ─────────────────────────────────────────────── index.html ───────────────────

function buildWeeklyChartData() {
  // Build daily pass-rate buckets for the last 7 days, per suite.
  const now = allRows.length ? Date.parse(allRows[allRows.length - 1].ts || '') : Date.now();
  const DAYS = 7;
  const labels = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(now - i * 86400e3);
    labels.push(d.toISOString().slice(5, 10)); // MM-DD
  }

  const datasets = [];
  for (const suite of suiteOrder) {
    const sr = bySuite(suite);
    const data = labels.map((label, idx) => {
      const dayStart = now - (DAYS - 1 - idx) * 86400e3;
      const dayEnd = dayStart + 86400e3;
      const dayRuns = sr.filter((r) => {
        const t = Date.parse(r.ts || '');
        return t >= dayStart && t < dayEnd;
      });
      if (!dayRuns.length) return null;
      return Math.round((dayRuns.filter((r) => r.outcome === 'passed').length / dayRuns.length) * 100);
    });
    datasets.push({ suite, color: colorOf(suite), data });
  }

  return { labels, datasets };
}

function buildSuiteCards() {
  return suiteOrder.map((suite) => {
    const sr = bySuite(suite);
    const latest = sr[sr.length - 1];
    const week = passRateOver(sr, 7 * 24 * 3600e3);
    const outcome = latest?.outcome ?? 'unknown';
    const outcomeColor =
      outcome === 'passed' ? '#1f883d' : outcome === 'failed' ? '#d1242f' : '#bf8700';
    return {
      suite,
      src: latest?._src ?? '—',
      outcome,
      outcomeColor,
      ts: fmtTs(latest?.ts),
      runUrl: latest?.run_url ?? null,
      passRate7d: week.pct,
      passRateN: week.n,
      trend: trendArrow(sr),
      streak: streak(sr),
    };
  });
}

function buildHtml() {
  const repo = process.env.GITHUB_REPOSITORY || 'this repo';
  const repoUrl = process.env.GITHUB_SERVER_URL
    ? `${process.env.GITHUB_SERVER_URL}/${repo}`
    : `https://github.com/${repo}`;
  const ts = fmtTs(allRows[allRows.length - 1]?.ts);
  const chartData = buildWeeklyChartData();
  const cards = buildSuiteCards();

  // Serialise only what the page needs (avoid leaking full test lists).
  const pageData = JSON.stringify({ chartData, cards, ts, repo, repoUrl });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>CI &amp; environment status — ${esc(repo)}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px -apple-system, Segoe UI, Helvetica, Arial, sans-serif; margin: 0; padding: 24px; max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 20px; } h2 { font-size: 15px; margin-top: 32px; }
  .meta { color: #656d76; font-size: 13px; margin-bottom: 16px; }
  .cards { display: flex; gap: 12px; flex-wrap: wrap; margin: 16px 0; }
  .card { border: 1px solid #d0d7de; border-radius: 8px; padding: 12px 16px; min-width: 160px; }
  .card .suite { font-size: 12px; color: #656d76; margin-bottom: 4px; }
  .card .outcome { font-size: 18px; font-weight: 700; }
  .card .detail { font-size: 11px; color: #656d76; margin-top: 4px; }
  canvas { max-height: 280px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border-bottom: 1px solid #d0d7de; padding: 6px 8px; text-align: left; }
  td.n { text-align: right; }
  .passed { color: #1f883d; } .failed { color: #d1242f; } .unknown { color: #bf8700; }
  a { color: #0969da; }
</style>
</head>
<body>
<h1>CI &amp; environment status</h1>
<p class="meta">Auto-generated · Last updated: <span id="ts"></span> · <a href="" id="repoLink" target="_blank"></a></p>
<div class="cards" id="cards"></div>
<h2>Weekly pass-rate trend (last 7 days)</h2>
<canvas id="weeklyChart"></canvas>
<script>
const D = ${pageData};
document.getElementById('ts').textContent = D.ts;
document.getElementById('repoLink').href = D.repoUrl;
document.getElementById('repoLink').textContent = D.repo;

// Suite cards
document.getElementById('cards').innerHTML = D.cards.map(c => {
  const rate = c.passRate7d !== null ? c.passRate7d + '% (7d, ' + c.passRateN + ' runs)' : 'no data';
  const runLink = c.runUrl ? ' <a href="' + c.runUrl + '" target="_blank">[run]</a>' : '';
  return '<div class="card">'
    + '<div class="suite">' + c.suite + ' <span style="color:#656d76;font-size:10px">(' + c.src + ')</span></div>'
    + '<div class="outcome" style="color:' + c.outcomeColor + '">' + c.outcome + runLink + '</div>'
    + '<div class="detail">' + rate + ' &nbsp; streak ' + c.streak + ' &nbsp; ' + c.trend + '</div>'
    + '<div class="detail">' + c.ts + '</div>'
    + '</div>';
}).join('');

// Weekly trend chart
const cd = D.chartData;
new Chart(document.getElementById('weeklyChart'), {
  type: 'line',
  data: {
    labels: cd.labels,
    datasets: cd.datasets.map(ds => ({
      label: ds.suite,
      data: ds.data,
      borderColor: ds.color,
      backgroundColor: ds.color,
      tension: 0.2,
      pointRadius: 3,
      spanGaps: true,
    })),
  },
  options: {
    scales: { y: { beginAtZero: true, max: 100, title: { display: true, text: 'Pass rate (%)' } } },
    plugins: { legend: { display: true, position: 'right' } },
  },
});
</script>
</body>
</html>`;
}

// ─────────────────────────────────────────────── write output ─────────────────

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

writeFileSync(join(outDir, 'trend.svg'), buildSvg());
writeFileSync(join(outDir, 'README.md'), buildReadme());
writeFileSync(join(outDir, 'index.html'), buildHtml());
console.log(
  `status-render: wrote trend.svg, README.md, index.html to ${outDir} ` +
    `(${ciRows.length} ci records, ${e2eRows.length} e2e records, ${suiteOrder.length} suite(s): ${suiteOrder.join(', ') || 'none'})`
);
