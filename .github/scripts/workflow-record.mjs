#!/usr/bin/env node
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: 'pipe', encoding: 'utf8', ...opts }).trim();
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function parseInput() {
  const raw = process.argv[2];
  if (!raw) {
    throw new Error('usage: node workflow-record.mjs "<json-record>"');
  }
  const record = JSON.parse(raw);
  if (!record.workflow || !record.category || !record.outcome) {
    throw new Error('record must include workflow, category, outcome');
  }
  return record;
}

function normalize(record) {
  const repo = process.env.GITHUB_REPOSITORY || '';
  const runId = process.env.GITHUB_RUN_ID || null;
  const sha = process.env.GITHUB_SHA || null;
  const detailUrl = runId && repo ? `https://github.com/${repo}/actions/runs/${runId}` : null;
  return {
    ts: record.ts || nowIso(),
    workflow: String(record.workflow),
    category: String(record.category),
    outcome: String(record.outcome),
    summary: record.summary ? String(record.summary) : '',
    detail_url: record.detail_url || detailUrl,
    run_number: Number(record.run_number || process.env.GITHUB_RUN_NUMBER || 0) || null,
    sha_short: record.sha_short || (sha ? sha.slice(0, 7) : undefined),
    env: record.env,
    cloud: record.cloud,
    metrics: record.metrics && typeof record.metrics === 'object' ? record.metrics : {},
  };
}

function appendRecord(line) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) {
    throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY are required');
  }

  const branch = 'workflow-history';
  const repoUrl = `https://x-access-token:${token}@github.com/${repo}.git`;

  for (let attempt = 1; attempt <= 5; attempt++) {
    const root = mkdtempSync(join(tmpdir(), 'workflow-history-'));
    const hist = join(root, 'hist');
    try {
      run('git', ['init', '-q', hist]);
      run('git', ['-C', hist, 'remote', 'add', 'origin', repoUrl]);
      try {
        run('git', ['-C', hist, 'fetch', '-q', '--depth', '1', 'origin', branch]);
        run('git', ['-C', hist, 'checkout', '-q', '-b', branch, 'FETCH_HEAD']);
      } catch {
        run('git', ['-C', hist, 'checkout', '-q', '--orphan', branch]);
      }

      const feed = join(hist, 'runs.jsonl');
      const prior = existsSync(feed) ? readFileSync(feed, 'utf8') : '';
      writeFileSync(feed, `${prior}${line}\n`);

      run('git', ['-C', hist, 'config', 'user.name', 'github-actions[bot]']);
      run('git', ['-C', hist, 'config', 'user.email', 'github-actions[bot]@users.noreply.github.com']);
      run('git', ['-C', hist, 'add', 'runs.jsonl']);
      run('git', ['-C', hist, 'commit', '-q', '-m', `workflow: record run ${process.env.GITHUB_RUN_ID || 'local'}`]);
      run('git', ['-C', hist, 'push', '-q', 'origin', branch]);
      console.log(`workflow-record: published to ${branch} (attempt ${attempt})`);
      return;
    } catch (error) {
      if (attempt === 5) throw error;
      console.log(`workflow-record: push rejected (attempt ${attempt}), retrying`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

try {
  const record = normalize(parseInput());
  appendRecord(JSON.stringify(record));
} catch (error) {
  console.error(`workflow-record: ${error.message || String(error)}`);
  process.exit(1);
}
