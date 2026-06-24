#!/usr/bin/env npx ts-node
/**
 * cleanup-copilot-assignments — act on the audit report from audit-copilot-assignments.ts.
 *
 * Reads scripts/copilot-audit-report.json (or --report <path>) and:
 *   likely_done     → close issue, remove Copilot assignment, strip stale labels, post comment
 *   no_pr + unassign → remove Copilot assignment, post comment (issue stays open)
 *   no_pr + skip    → log and skip
 *   has_open_pr     → skip (pipeline manages these)
 *
 * Usage:
 *   npx ts-node scripts/cleanup-copilot-assignments.ts --dry-run    (default; no API calls)
 *   npx ts-node scripts/cleanup-copilot-assignments.ts --confirm    (execute)
 *   npx ts-node scripts/cleanup-copilot-assignments.ts --confirm --report /path/to/report.json
 */

import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--confirm');
const REPORT_ARG = args.indexOf('--report');
const REPORT_PATH = REPORT_ARG !== -1
  ? args[REPORT_ARG + 1]
  : resolve(__dirname, 'copilot-audit-report.json');
const REPO = 'Volaris-AI/project-template';

if (DRY_RUN) {
  console.log('[dry-run] No API calls will be made. Pass --confirm to execute.');
}

// ---------------------------------------------------------------------------
// Load report
// ---------------------------------------------------------------------------

let report: {
  summary: Record<string, number>;
  likely_done: Array<{
    issue_number: number;
    issue_title: string;
    issue_labels: string[];
    merged_pr: number;
    merged_pr_title: string;
    merged_at: string;
    confidence: string;
    match_signals: string[];
  }>;
  has_open_pr: Array<{ issue_number: number }>;
  no_pr_found: Array<{
    issue_number: number;
    issue_title: string;
    issue_labels: string[];
    recommendation: string;
    is_epic: boolean;
  }>;
};

try {
  report = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
} catch (e) {
  console.error(`Cannot read report at ${REPORT_PATH}`);
  console.error('Run: npx ts-node scripts/audit-copilot-assignments.ts');
  process.exit(1);
}

console.log(`\nReport: ${REPORT_PATH}`);
console.log(`Summary: ${JSON.stringify(report.summary, null, 2)}\n`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Post a comment body safely by writing it to a temp file to avoid shell quoting issues.
function ghComment(issueNumber: number, body: string, description?: string): void {
  if (DRY_RUN) {
    console.log(`  [dry-run] gh issue comment ${issueNumber} --body-file <tmpfile>`);
    return;
  }
  if (description) console.log(`  → ${description}`);
  const tmp = resolve(tmpdir(), `gh-comment-${issueNumber}-${Date.now()}.txt`);
  try {
    writeFileSync(tmp, body, 'utf8');
    execSync(`gh issue comment ${issueNumber} --body-file "${tmp}" --repo ${REPO}`, { encoding: 'utf8' });
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}

function gh(cmd: string, description?: string): string {
  if (DRY_RUN) {
    console.log(`  [dry-run] gh ${cmd}`);
    return '';
  }
  if (description) console.log(`  → ${description}`);
  return execSync(`gh ${cmd}`, { encoding: 'utf8' });
}

// The Copilot bot doesn't appear in assignableUsers (bots are excluded).
// Fetch its node_id from an issue we know it's currently assigned to,
// falling back to the stable hardcoded value if no such issue is available.
const COPILOT_BOT_NODE_ID_FALLBACK = 'BOT_kgDOC9w8XQ';
let _botId: string | null = null;
function getBotId(): string {
  if (_botId) return _botId;
  // Try to find the node_id from any assigned issue in the report.
  const anyIssue = report.likely_done[0]?.issue_number ?? report.no_pr_found[0]?.issue_number;
  if (anyIssue) {
    try {
      const raw = execSync(
        `gh api repos/${REPO}/issues/${anyIssue} --jq '.assignees[]|select(.login=="Copilot")|.node_id'`,
        { encoding: 'utf8' }
      ).trim();
      if (raw) { _botId = raw; return _botId; }
    } catch {}
  }
  _botId = COPILOT_BOT_NODE_ID_FALLBACK;
  return _botId;
}

function removeAssignee(issueNumber: number): void {
  if (DRY_RUN) {
    console.log(`  [dry-run] GraphQL: removeAssigneesFromAssignable on issue #${issueNumber}`);
    return;
  }
  // node_id comes back as a quoted JSON string from --jq; strip the quotes.
  const issueId = execSync(
    `gh api repos/${REPO}/issues/${issueNumber} --jq '.node_id'`,
    { encoding: 'utf8' }
  ).trim().replace(/^"|"$/g, '');
  const botId = getBotId().replace(/^"|"$/g, '');
  execSync(
    `gh api graphql -f query='mutation($id:ID!,$botId:ID!){removeAssigneesFromAssignable(input:{assignableId:$id,assigneeIds:[$botId]}){assignable{... on Issue{number}}}}' -f id="${issueId}" -f botId="${botId}"`,
    { encoding: 'utf8' }
  );
  console.log(`  → Removed Copilot assignment from #${issueNumber}`);
}

// ---------------------------------------------------------------------------
// Process likely_done
// ---------------------------------------------------------------------------

console.log(`=== likely_done: ${report.likely_done.length} issues ===\n`);

for (const item of report.likely_done) {
  console.log(`#${item.issue_number}: ${item.issue_title}`);
  console.log(`  Merged PR: #${item.merged_pr} (${item.merged_at.split('T')[0]}) — confidence: ${item.confidence}`);
  console.log(`  Signals: ${item.match_signals.join(', ')}`);

  const commentBody = [
    `Closing — work was delivered by PR #${item.merged_pr} (merged ${item.merged_at.split('T')[0]}).`,
    `The PR did not include a \`Closes #${item.issue_number}\` keyword so GitHub did not auto-close this issue at merge time.`,
    `See [docs/specs/copilot-assignment-cleanup.md](docs/specs/copilot-assignment-cleanup.md) for the root-cause analysis.`,
  ].join(' ');

  ghComment(item.issue_number, commentBody, `Post close comment on #${item.issue_number}`);

  removeAssignee(item.issue_number);

  // Remove stale labels if present
  for (const label of ['ready-for-dev', 'queue:development']) {
    if (item.issue_labels.includes(label)) {
      gh(`issue edit ${item.issue_number} --remove-label "${label}" --repo ${REPO}`, `Remove label "${label}" from #${item.issue_number}`);
    }
  }

  gh(`issue close ${item.issue_number} --reason completed --repo ${REPO}`, `Close #${item.issue_number} as completed`);
  console.log('');
}

// ---------------------------------------------------------------------------
// Process no_pr_found
// ---------------------------------------------------------------------------

const toUnassign = report.no_pr_found.filter(i => i.recommendation === 'unassign');
const toSkip = report.no_pr_found.filter(i => i.recommendation === 'skip');

console.log(`\n=== no_pr_found / unassign: ${toUnassign.length} issues ===\n`);

for (const item of toUnassign) {
  console.log(`#${item.issue_number}: ${item.issue_title}`);
  console.log(`  Labels: ${item.issue_labels.join(', ')}`);

  const commentBody = `Unassigning Copilot — no PR was opened from this assignment. The factory pipeline will re-assign when capacity exists and the issue is next in priority order.`;

  ghComment(item.issue_number, commentBody, `Post unassign comment on #${item.issue_number}`);
  removeAssignee(item.issue_number);
  console.log('');
}

console.log(`\n=== no_pr_found / skip: ${toSkip.length} issues (no action) ===\n`);
for (const item of toSkip) {
  console.log(`  skip #${item.issue_number} (epic:${item.is_epic}): ${item.issue_title}`);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n=== has_open_pr: ${report.has_open_pr.length} issues (pipeline manages) ===`);

console.log(`\n--- ${DRY_RUN ? 'Dry-run' : 'Execution'} complete ---`);
console.log(`  Closed:    ${report.likely_done.length}`);
console.log(`  Unassigned:${toUnassign.length}`);
console.log(`  Skipped:   ${toSkip.length + report.has_open_pr.length}`);
if (DRY_RUN) {
  console.log('\nRe-run with --confirm to execute.');
}
