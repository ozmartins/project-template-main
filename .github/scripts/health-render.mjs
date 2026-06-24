#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [, , workflowDir = './workflow-history', ciDir = './ci-history', e2eDir = './e2e-history', outDir = './docs/ci-status'] = process.argv;

function readJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
}

const workflowRows = readJsonl(join(workflowDir, 'runs.jsonl'));
const ciRows = readJsonl(join(ciDir, 'runs.jsonl'));
const e2eRows = readJsonl(join(e2eDir, 'runs.jsonl'));
const targets = readJson(join(process.cwd(), '.github/qa-targets.json'), { suites: {}, quality: {}, deploy: {} });

function fmtTs(ts) {
  return ts ? String(ts).replace('T', ' ').replace(/:\d\d(\.\d+)?Z$/, 'Z') : '—';
}

function icon(outcome) {
  return outcome === 'passed' ? '✅' : outcome === 'warning' ? '⚠️' : outcome === 'skipped' ? '⏭️' : outcome === 'failed' ? '❌' : '🟠';
}

function passRate(rows, days = 7) {
  if (!rows.length) return null;
  const anchor = Date.parse(rows[rows.length - 1].ts || '') || Date.now();
  const cut = anchor - days * 24 * 3600 * 1000;
  const win = rows.filter((r) => (Date.parse(r.ts || '') || 0) >= cut);
  if (!win.length) return null;
  const passed = win.filter((r) => r.outcome === 'passed').length;
  return { pct: Math.round((passed / win.length) * 100), n: win.length };
}

function seriesSvg(title, keys, rowsByKey, valueFn, yLabel = '%') {
  const w = 920;
  const h = 260;
  const pad = { l: 52, r: 180, t: 28, b: 36 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  const palette = ['#1f883d', '#0969da', '#bf8700', '#8250df', '#cf222e', '#1b7c83', '#9a6700', '#bc4c00'];
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let maxY = 100;
  for (const key of keys) {
    const vals = rowsByKey(key).slice(-60).map((r) => valueFn(r)).filter((v) => Number.isFinite(v));
    if (vals.length) maxY = Math.max(maxY, Math.ceil(Math.max(...vals)));
  }
  const y = (v) => pad.t + plotH - ((v || 0) / (maxY || 1)) * plotH;
  const x = (i, n) => pad.l + (n <= 1 ? plotW / 2 : (plotW * i) / (n - 1));

  let body = `<text x="${pad.l}" y="${pad.t - 10}" font-size="12" font-weight="600" fill="#1f2328">${esc(title)}</text>`;
  for (let g = 0; g <= 4; g++) {
    const v = (maxY * g) / 4;
    const yy = y(v);
    body += `<line x1="${pad.l}" y1="${yy.toFixed(1)}" x2="${pad.l + plotW}" y2="${yy.toFixed(1)}" stroke="#e1e4e8" stroke-width="1"/>`;
    body += `<text x="${pad.l - 8}" y="${(yy + 3).toFixed(1)}" font-size="10" fill="#656d76" text-anchor="end">${Math.round(v)}${esc(yLabel)}</text>`;
  }

  let legendY = pad.t + 4;
  for (const [i, key] of keys.entries()) {
    const runs = rowsByKey(key).slice(-60);
    if (!runs.length) continue;
    const color = palette[i % palette.length];
    const points = runs.map((r, idx) => [x(idx, runs.length), y(valueFn(r))]);
    const path = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    body += points.length === 1
      ? `<circle cx="${points[0][0].toFixed(1)}" cy="${points[0][1].toFixed(1)}" r="3" fill="${color}"/>`
      : `<path d="${path}" fill="none" stroke="${color}" stroke-width="2"/>`;
    body += `<rect x="${pad.l + plotW + 16}" y="${legendY - 9}" width="11" height="11" rx="2" fill="${color}"/>`;
    body += `<text x="${pad.l + plotW + 32}" y="${legendY}" font-size="11" fill="#1f2328">${esc(key)}</text>`;
    legendY += 20;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif"><rect width="${w}" height="${h}" fill="#fff"/>${body}</svg>`;
}

const ciSuites = ['unit', 'temporal', 'helm', 'seed'];
const e2eSuites = ['smoke', 'experience'];

const deployKeys = [...new Set(workflowRows.filter((r) => r.category === 'deploy').map((r) => `${r.env || 'unknown'}-${r.cloud || 'unknown'}`))];
const qualityKeys = [...new Set(workflowRows.filter((r) => r.category === 'quality').map((r) => r.workflow))];
const securityKeys = [...new Set(workflowRows.filter((r) => ['security', 'audit'].includes(r.category)).map((r) => r.workflow))];

const testSvg = seriesSvg('CI pass-rate by suite (last 60 runs each)', ciSuites, (k) => ciRows.filter((r) => r.suite === k), (r) => (r.pass_rate ?? (r.outcome === 'passed' ? 1 : 0)) * 100);
const e2eSvg = seriesSvg('E2E pass-rate by suite (last 60 runs each)', e2eSuites, (k) => e2eRows.filter((r) => r.suite === k), (r) => (r.pass_rate ?? (r.outcome === 'passed' ? 1 : 0)) * 100);
const deploySvg = seriesSvg('Deploy success rate by env×cloud', deployKeys, (k) => workflowRows.filter((r) => r.category === 'deploy' && `${r.env || 'unknown'}-${r.cloud || 'unknown'}` === k), (r) => (r.outcome === 'passed' ? 100 : 0));
const qualitySvg = seriesSvg('Quality workflow outcomes', qualityKeys, (k) => workflowRows.filter((r) => r.category === 'quality' && r.workflow === k), (r) => (r.outcome === 'passed' ? 100 : r.outcome === 'warning' ? 50 : 0));
const securitySvg = seriesSvg('Security/audit finding count trend', securityKeys, (k) => workflowRows.filter((r) => ['security', 'audit'].includes(r.category) && r.workflow === k), (r) => Number(r.metrics?.finding_count ?? 0), '');

function suiteTable(rows, suites) {
  let out = '| Suite | Last outcome | Last run | Pass 24h | Pass 7d | SLO | Streak |\n|---|---|---|---:|---:|---|---:|\n';
  for (const suite of suites) {
    const sr = rows.filter((r) => r.suite === suite);
    const latest = sr[sr.length - 1];
    const day = passRate(sr, 1);
    const week = passRate(sr, 7);
    const min = targets.suites?.[suite]?.pass_rate_7d_min;
    const breach = min != null && week?.pct != null && week.pct < min ? '⚠️' : '✅';
    let streak = 0;
    for (let i = sr.length - 1; i >= 0; i--) {
      if (sr[i].outcome === 'passed') streak += 1;
      else break;
    }
    out += `| \`${suite}\` | ${latest ? `${icon(latest.outcome)} ${latest.outcome}` : '—'} | ${fmtTs(latest?.ts)} | ${day ? `${day.pct}% (${day.n})` : '—'} | ${week ? `${week.pct}% (${week.n})` : '—'} | ${min != null ? `${breach} ≥${min}%` : '—'} | ${streak} |\n`;
  }
  return out;
}

function latestWorkflowRow(name) {
  const rows = workflowRows.filter((r) => r.workflow === name);
  return rows[rows.length - 1];
}

async function fetchIncidents() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return [];
  const url = `https://api.github.com/repos/${repo}/issues?state=open&labels=priority:critical&per_page=100`;
  try {
    const headers = new Headers({
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    });
    headers.set('Authorization', `token ${token}`);
    const res = await fetch(url, {
      headers,
    });
    if (!res.ok) return [];
    const issues = await res.json();
    return issues.filter((i) => !i.pull_request);
  } catch {
    return [];
  }
}

function unstableTestsSection() {
  const windowMs = 7 * 24 * 3600 * 1000;
  const all = [...ciRows, ...e2eRows];
  const latestTs = all.length ? Date.parse(all[all.length - 1].ts || '') || Date.now() : Date.now();
  const recent = all.filter((r) => (Date.parse(r.ts || '') || 0) >= latestTs - windowMs);
  const agg = new Map();
  for (const r of recent) {
    for (const t of r.tests || []) {
      if (t.status !== 'failed' && t.status !== 'flaky') continue;
      const key = `${r.suite}::${t.title}`;
      const a = agg.get(key) || { suite: r.suite, title: t.title, failures: 0 };
      a.failures += 1;
      agg.set(key, a);
    }
  }
  const items = [...agg.values()].sort((a, b) => b.failures - a.failures).slice(0, 20);
  if (!items.length) return '_No unstable tests in the last 7 days._';
  let out = '| Test | Suite | Failures (7d) |\n|---|---|---:|\n';
  for (const item of items) {
    out += `| ${String(item.title).replace(/\|/g, '\\|')} | \`${item.suite}\` | ${item.failures} |\n`;
  }
  return out;
}

const opsWorkflows = ['pipeline-daily', 'monitor-actions', 'validate-dsl-definitions', 'validate-ontology'];
const deployRows = workflowRows.filter((r) => r.category === 'deploy');

const incidents = await fetchIncidents();

let summary = `# Engineering health dashboard\n\n`;
summary += `Generated: ${fmtTs(new Date().toISOString())}\n\n`;
summary += `## CI suites\n\n${suiteTable(ciRows, ciSuites)}\n`;
summary += `## E2E suites\n\n${suiteTable(e2eRows, e2eSuites)}\n`;

summary += `## Deployments\n\n| Env×Cloud | Last deployed | SHA | Outcome | Pass 7d | Staleness |\n|---|---|---|---|---:|---|\n`;
for (const key of deployKeys) {
  const [envName] = key.split('-');
  const rows = deployRows.filter((r) => `${r.env || 'unknown'}-${r.cloud || 'unknown'}` === key);
  const last = rows[rows.length - 1];
  const week = passRate(rows, 7);
  const hours = last?.ts ? Math.round((Date.now() - Date.parse(last.ts)) / 3600000) : null;
  const maxHours = envName === 'dev' ? targets.deploy?.max_hours_since_last_dev_deploy : envName === 'test' ? targets.deploy?.max_hours_since_last_test_deploy : null;
  const stale = hours != null && maxHours != null && hours > maxHours ? `⚠️ ${hours}h` : hours != null ? `${hours}h` : '—';
  summary += `| \`${key}\` | ${fmtTs(last?.ts)} | ${last?.sha_short ? `\`${last.sha_short}\`` : '—'} | ${last ? `${icon(last.outcome)} ${last.outcome}` : '—'} | ${week ? `${week.pct}% (${week.n})` : '—'} | ${stale} |\n`;
}

summary += `\n## Code quality\n\n| Workflow | Last run | Outcome | Metrics |\n|---|---|---|---|\n`;
for (const key of qualityKeys) {
  const row = latestWorkflowRow(key);
  const metrics = row?.metrics ? Object.entries(row.metrics).map(([k, v]) => `${k}=${v}`).join(', ') : '—';
  summary += `| \`${key}\` | ${fmtTs(row?.ts)} | ${row ? `${icon(row.outcome)} ${row.outcome}` : '—'} | ${metrics || '—'} |\n`;
}

summary += `\n## Security & audits\n\n| Workflow | Last run | Outcome | Finding count |\n|---|---|---|---:|\n`;
for (const key of securityKeys) {
  const row = latestWorkflowRow(key);
  summary += `| \`${key}\` | ${fmtTs(row?.ts)} | ${row ? `${icon(row.outcome)} ${row.outcome}` : '—'} | ${Number(row?.metrics?.finding_count ?? 0)} |\n`;
}

summary += `\n## Ops workflows\n\n| Workflow | Last run | Outcome |\n|---|---|---|\n`;
for (const name of opsWorkflows) {
  const row = latestWorkflowRow(name);
  summary += `| \`${name}\` | ${fmtTs(row?.ts)} | ${row ? `${icon(row.outcome)} ${row.outcome}` : '—'} |\n`;
}

summary += `\n## Unstable tests\n\n${unstableTestsSection()}\n`;
summary += `\n## Open incidents\n\n`;
if (!incidents.length) {
  summary += '_No open `priority:critical` incidents._\n';
} else {
  summary += '| Issue | Title | Updated |\n|---|---|---|\n';
  for (const issue of incidents.slice(0, 30)) {
    summary += `| [#${issue.number}](${issue.html_url}) | ${String(issue.title).replace(/\|/g, '\\|')} | ${fmtTs(issue.updated_at)} |\n`;
  }
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'trend-tests.svg'), testSvg);
writeFileSync(join(outDir, 'trend-e2e.svg'), e2eSvg);
writeFileSync(join(outDir, 'trend-deploy.svg'), deploySvg);
writeFileSync(join(outDir, 'trend-quality.svg'), qualitySvg);
writeFileSync(join(outDir, 'trend-security.svg'), securitySvg);
writeFileSync(join(outDir, 'summary.md'), summary);
console.log(`health-render: wrote dashboard to ${outDir}`);
