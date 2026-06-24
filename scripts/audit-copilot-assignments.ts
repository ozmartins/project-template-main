#!/usr/bin/env npx ts-node
/**
 * audit-copilot-assignments — find ghost Copilot assignments and classify each one.
 *
 * Outputs scripts/copilot-audit-report.json with three buckets:
 *   likely_done   — a merged Copilot PR almost certainly delivered this issue
 *   has_open_pr   — an open Copilot PR is already covering this issue
 *   no_pr_found   — no PR evidence; recommendation is "unassign" or "skip"
 *
 * Usage:
 *   npx ts-node scripts/audit-copilot-assignments.ts
 *   npx ts-node scripts/audit-copilot-assignments.ts --output /tmp/report.json
 */

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REPO = 'Volaris-AI/project-template';
const OUTPUT_ARG = process.argv.indexOf('--output');
const OUTPUT_PATH = OUTPUT_ARG !== -1
  ? process.argv[OUTPUT_ARG + 1]
  : resolve(__dirname, 'copilot-audit-report.json');

const SKIP_QUEUE_LABELS = new Set([
  'queue:architecture',
  'queue:platform',
  'queue:security',
  'queue:database',
]);

const TYPE_PREFIXES = /^(feat|fix|chore|docs|test|ci|refactor|perf|style|build)\s*[(:]/i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gh(args: string): string {
  return execSync(`gh ${args}`, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

function tokenise(title: string): Set<string> {
  const cleaned = title.toLowerCase().replace(TYPE_PREFIXES, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return new Set(cleaned.split(/\s+/).filter(t => t.length > 2));
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Fetch data
// ---------------------------------------------------------------------------

console.error('Fetching assigned issues...');
// GitHub Issues API returns both issues and PRs (they share number space).
// Filter out PRs — they have a pull_request key.
const assignedIssues: Array<{
  number: number;
  title: string;
  labels: Array<{ name: string }>;
  assignees: Array<{ login: string }>;
  createdAt: string;
  updatedAt: string;
}> = (JSON.parse(
  gh(`api "repos/${REPO}/issues?state=open&assignee=copilot-swe-agent%5Bbot%5D&per_page=100"`)
) as any[])
  .filter((i: any) => !i.pull_request)
  .map((i: any) => ({
    number: i.number,
    title: i.title,
    labels: i.labels,
    assignees: i.assignees,
    createdAt: i.created_at,
    updatedAt: i.updated_at,
  }));

console.error('Fetching open Copilot PRs...');
const openPrsRaw: Array<{
  number: number;
  title: string;
  headRefName: string;
  closingIssuesReferences: Array<{ number: number }>;
}> = JSON.parse(
  gh(`pr list --author "copilot-swe-agent[bot]" --state open --json number,title,headRefName,closingIssuesReferences --limit 100 --repo ${REPO}`)
);

console.error('Fetching merged Copilot PRs (last 200)...');
const mergedPrsRaw: Array<{
  number: number;
  title: string;
  headRefName: string;
  mergedAt: string;
  closingIssuesReferences: Array<{ number: number }>;
}> = JSON.parse(
  gh(`pr list --author "copilot-swe-agent[bot]" --state merged --json number,title,headRefName,mergedAt,closingIssuesReferences --limit 200 --repo ${REPO}`)
);

console.error(`Open PRs: ${openPrsRaw.length}, Merged PRs: ${mergedPrsRaw.length}`);

// ---------------------------------------------------------------------------
// Build coverage maps
// ---------------------------------------------------------------------------

// open PR → set of covered issue numbers (three signals)
function coveredIssues(prs: typeof openPrsRaw, issueNumbers: Set<number>): Map<number, { prNumber: number; prTitle: string; prBranch: string; matchSignal: string }> {
  const map = new Map<number, { prNumber: number; prTitle: string; prBranch: string; matchSignal: string }>();
  for (const pr of prs) {
    // Signal 1: closingIssuesReferences
    for (const ref of pr.closingIssuesReferences ?? []) {
      if (issueNumbers.has(ref.number)) {
        map.set(ref.number, { prNumber: pr.number, prTitle: pr.title, prBranch: pr.headRefName, matchSignal: 'closingIssuesReferences' });
      }
    }
    // Signal 2: issue number in branch name
    const branchMatch = pr.headRefName.match(/\b(\d+)\b/g);
    if (branchMatch) {
      for (const numStr of branchMatch) {
        const n = parseInt(numStr, 10);
        if (issueNumbers.has(n) && !map.has(n)) {
          map.set(n, { prNumber: pr.number, prTitle: pr.title, prBranch: pr.headRefName, matchSignal: 'branch_number' });
        }
      }
    }
    // Signal 3: #N in PR title
    const titleMatch = pr.title.match(/#(\d+)/g);
    if (titleMatch) {
      for (const t of titleMatch) {
        const n = parseInt(t.slice(1), 10);
        if (issueNumbers.has(n) && !map.has(n)) {
          map.set(n, { prNumber: pr.number, prTitle: pr.title, prBranch: pr.headRefName, matchSignal: 'title_ref' });
        }
      }
    }
  }
  return map;
}

const issueNums = new Set(assignedIssues.map(i => i.number));
const openCoverage = coveredIssues(openPrsRaw, issueNums);

// For merged PRs, build a similar map but note mergedAt
function mergedCoverage(prs: typeof mergedPrsRaw, issueNumbers: Set<number>): Map<number, { prNumber: number; prTitle: string; mergedAt: string; matchSignals: string[]; confidence: string }> {
  const map = new Map<number, { prNumber: number; prTitle: string; mergedAt: string; matchSignals: string[]; confidence: string }>();

  for (const pr of prs) {
    const signals: string[] = [];

    // Signal 1: closingIssuesReferences
    for (const ref of pr.closingIssuesReferences ?? []) {
      if (issueNumbers.has(ref.number)) {
        if (!map.has(ref.number)) {
          map.set(ref.number, { prNumber: pr.number, prTitle: pr.title, mergedAt: pr.mergedAt, matchSignals: ['closingIssuesReferences'], confidence: 'high' });
        }
      }
    }
    // Signal 2: branch number
    const branchNums = (pr.headRefName.match(/\b(\d+)\b/g) ?? []).map(s => parseInt(s, 10));
    for (const n of branchNums) {
      if (issueNumbers.has(n)) signals.push('branch_number');
      if (issueNumbers.has(n) && !map.has(n)) {
        map.set(n, { prNumber: pr.number, prTitle: pr.title, mergedAt: pr.mergedAt, matchSignals: ['branch_number'], confidence: 'medium' });
      }
    }
    // Signal 3: title #N
    const titleNums = (pr.title.match(/#(\d+)/g) ?? []).map(s => parseInt(s.slice(1), 10));
    for (const n of titleNums) {
      if (issueNumbers.has(n)) {
        if (!map.has(n)) {
          map.set(n, { prNumber: pr.number, prTitle: pr.title, mergedAt: pr.mergedAt, matchSignals: ['title_ref'], confidence: 'medium' });
        }
      }
    }
  }

  // Signal 4: sequential number + title token overlap
  // For each unmatched issue, check PR at issue+1 and issue+2 for >=3 overlapping tokens
  const mergedByNumber = new Map(prs.map(p => [p.number, p]));
  for (const issue of assignedIssues) {
    if (map.has(issue.number)) continue;
    const issueToks = tokenise(issue.title);
    for (const delta of [1, 2]) {
      const candidate = mergedByNumber.get(issue.number + delta);
      if (!candidate) continue;
      const prToks = tokenise(candidate.title);
      const shared = overlap(issueToks, prToks);
      if (shared >= 3) {
        map.set(issue.number, {
          prNumber: candidate.number,
          prTitle: candidate.title,
          mergedAt: candidate.mergedAt,
          matchSignals: [`sequential_number`, `title_tokens:${shared}`],
          confidence: shared >= 4 ? 'high' : 'medium',
        });
        break;
      }
    }
  }

  return map;
}

const mergedCov = mergedCoverage(mergedPrsRaw, issueNums);

// ---------------------------------------------------------------------------
// Classify each issue
// ---------------------------------------------------------------------------

const likelyDone: any[] = [];
const hasOpenPr: any[] = [];
const noPrFound: any[] = [];

for (const issue of assignedIssues) {
  const labels = issue.labels.map(l => l.name);
  const assignedDaysAgo = Math.floor((Date.now() - new Date(issue.updatedAt).getTime()) / (1000 * 60 * 60 * 24));

  if (openCoverage.has(issue.number)) {
    const cov = openCoverage.get(issue.number)!;
    hasOpenPr.push({
      issue_number: issue.number,
      issue_title: issue.title,
      open_pr: cov.prNumber,
      pr_title: cov.prTitle,
      pr_branch: cov.prBranch,
      match_signal: cov.matchSignal,
    });
    continue;
  }

  if (mergedCov.has(issue.number)) {
    const cov = mergedCov.get(issue.number)!;
    likelyDone.push({
      issue_number: issue.number,
      issue_title: issue.title,
      issue_labels: labels,
      merged_pr: cov.prNumber,
      merged_pr_title: cov.prTitle,
      merged_at: cov.mergedAt,
      confidence: cov.confidence,
      match_signals: cov.matchSignals,
    });
    continue;
  }

  // Determine recommendation
  const isEpic = issue.title.toLowerCase().startsWith('epic:') || issue.title.toLowerCase().startsWith('epic ');
  const hasSkipQueue = labels.some(l => SKIP_QUEUE_LABELS.has(l));
  const recommendation = (isEpic || hasSkipQueue) ? 'skip' : 'unassign';

  noPrFound.push({
    issue_number: issue.number,
    issue_title: issue.title,
    issue_labels: labels,
    is_epic: isEpic,
    has_skip_queue: hasSkipQueue,
    assigned_days_ago: assignedDaysAgo,
    recommendation,
  });
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const report = {
  generated_at: new Date().toISOString(),
  repo: REPO,
  summary: {
    total_assigned: assignedIssues.length,
    likely_done: likelyDone.length,
    has_open_pr: hasOpenPr.length,
    no_pr_found: noPrFound.length,
    no_pr_unassign: noPrFound.filter(i => i.recommendation === 'unassign').length,
    no_pr_skip: noPrFound.filter(i => i.recommendation === 'skip').length,
  },
  likely_done: likelyDone,
  has_open_pr: hasOpenPr,
  no_pr_found: noPrFound,
};

writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
console.error(`\nReport written to: ${OUTPUT_PATH}`);
console.error(JSON.stringify(report.summary, null, 2));
