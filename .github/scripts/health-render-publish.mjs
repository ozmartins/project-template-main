#!/usr/bin/env node
import { mkdtempSync, rmSync, existsSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: 'pipe', encoding: 'utf8', ...opts }).trim();
}

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
if (!token || !repo) {
  console.error('health-render-publish: GITHUB_TOKEN and GITHUB_REPOSITORY are required');
  process.exit(1);
}

const repoUrl = `https://x-access-token:${token}@github.com/${repo}.git`;
const work = mkdtempSync(join(tmpdir(), 'health-render-'));

function cloneBranch(branch, target, optional = true) {
  try {
    run('git', ['clone', '-q', '--depth', '1', '--branch', branch, repoUrl, target]);
    return true;
  } catch {
    if (!optional) throw new Error(`failed to clone ${branch}`);
    return false;
  }
}

try {
  const mainDir = join(work, 'main');
  cloneBranch('main', mainDir, false);

  const workflowDir = join(work, 'workflow-history');
  const ciDir = join(work, 'ci-history');
  const e2eDir = join(work, 'e2e-history');

  mkdirSync(workflowDir, { recursive: true });
  mkdirSync(ciDir, { recursive: true });
  mkdirSync(e2eDir, { recursive: true });

  const wfClone = join(work, 'wf');
  const ciClone = join(work, 'ci');
  const e2eClone = join(work, 'e2e');
  if (cloneBranch('workflow-history', wfClone) && existsSync(join(wfClone, 'runs.jsonl'))) cpSync(join(wfClone, 'runs.jsonl'), join(workflowDir, 'runs.jsonl'));
  if (cloneBranch('ci-history', ciClone) && existsSync(join(ciClone, 'runs.jsonl'))) cpSync(join(ciClone, 'runs.jsonl'), join(ciDir, 'runs.jsonl'));
  if (cloneBranch('e2e-history', e2eClone) && existsSync(join(e2eClone, 'runs.jsonl'))) cpSync(join(e2eClone, 'runs.jsonl'), join(e2eDir, 'runs.jsonl'));

  run('node', [join(mainDir, '.github/scripts/health-render.mjs'), workflowDir, ciDir, e2eDir, join(mainDir, 'docs/ci-status')], {
    env: { ...process.env, GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo },
  });

  run('git', ['-C', mainDir, 'config', 'user.name', 'github-actions[bot]']);
  run('git', ['-C', mainDir, 'config', 'user.email', 'github-actions[bot]@users.noreply.github.com']);
  run('git', ['-C', mainDir, 'add', 'docs/ci-status']);
  try {
    run('git', ['-C', mainDir, 'diff', '--cached', '--quiet']);
    console.log('health-render-publish: no dashboard changes to commit');
    process.exit(0);
  } catch {}

  run('git', ['-C', mainDir, 'commit', '-q', '-m', 'chore(ci): regenerate health dashboard [skip ci]']);
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      run('git', ['-C', mainDir, 'push', '-q', 'origin', 'main']);
      console.log(`health-render-publish: pushed main (attempt ${attempt})`);
      process.exit(0);
    } catch {
      if (attempt === 5) throw new Error('failed to push dashboard updates after retries');
      run('git', ['-C', mainDir, 'fetch', '-q', 'origin', 'main']);
      run('git', ['-C', mainDir, 'rebase', 'origin/main']);
    }
  }
} catch (error) {
  console.error(`health-render-publish: ${error.message || String(error)}`);
  process.exit(1);
} finally {
  rmSync(work, { recursive: true, force: true });
}
