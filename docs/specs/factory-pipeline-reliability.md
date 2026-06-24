# Factory Pipeline Reliability Spec

**Status:** Draft  
**Scope:** `pipeline-fast.yml`, `run-assignment.ts`, `run-pr-pipeline.ts`, `pr-snapshot.ts`, `project-manager.agent.md`, `pr-handler.agent.md`

---

## 1. Current Reality (as of 2026-06-21)

**The pipeline IS working — but at 50% of available throughput, with two hard blockers preventing it from reaching steady state.**

### What is working well

- Stage 2a processed **46 PRs** in the last pass (~34 min run), merging **25 PRs in the past 24h**
- The pr-handler agent is making good decisions: reviewing, approving, merging, nudging conflicts, handling `action_required` CI gates correctly
- Stage 0 stale re-kick fires and correctly skips when open PRs >= max
- Continue-on-error means no single failure blocks the pipeline

### What is broken

**Blocker 1 — Snapshot truncation: 49 of 92 PRs are invisible to the loop**

`pr-snapshot.ts` uses `first:100` in the GraphQL query. This was raised from 50 recently but is still insufficient — there are 92 open PRs and the snapshot only returns 50 (oldest-first). The newest 42 PRs are never seen. They will never be reviewed, approved, or merged until older PRs drain below 50.

Last run evidence: `"open":50,"actionable":50` in the pipeline plan log, while `gh pr list` returns 92.

**Blocker 2 — Stage 2b PM agent errors on every pass: `linkedPullRequests` field doesn't exist**

Every Stage 2b run ends in `gh: Field 'linkedPullRequests' doesn't exist on type 'Issue'` after spending 12 seconds and 21k input tokens. The PM agent is told to call this nonexistent GraphQL field. Stage 2b therefore never completes stale cleanup or new assignment — no issues are being assigned to fill capacity as PRs merge.

Last run evidence: `OK: gh: Field 'linkedPullRequests' doesn't exist on type 'Issue'` → `<exited with exit code 1>` — every single run.

### Current numbers

| Metric | Value |
|--------|-------|
| Open Copilot PRs | 92 |
| Drafts (still being worked) | 63 |
| Non-draft, MERGEABLE | 25 |
| Non-draft, CONFLICTING | 16 |
| Non-draft, approved + no blocker | 3 (ready to merge NOW) |
| Non-draft, needs review + no blocker | 16 |
| Blocked on `needs-platform-review` | 5 |
| Blocked on `needs-database-review` | 1 |
| Has `changes-requested` (user, unaddressed) | 11 |
| Assigned issues with no open PR | 61 |
| PRs merged in last 24h | 25 |
| PRs seen by handler per pass | 50 (should be 92) |

---

## 2. Problem Statement

---

## 3. Desired End State

1. **Queue drains.** PRs that are APPROVED + green CI + MERGEABLE are merged every pass without exception.
2. **Conflicts are resolved.** Copilot is given one clear instruction to resolve in-place. If it fails, the PR is re-kicked from a clean base. The re-kick is logged and the cycle continues.
3. **Stale assignments are re-kicked reliably.** An assigned issue with no open PR gets one re-kick per pass, up to the capacity limit. No flood.
4. **CI failures are diagnosed, not just flagged.** The handler distinguishes: stale base (fix silently), cancelled run (rerun), `action_required` gate (trusted-actor push), and real failures (nudge Copilot with specific failure).
5. **Throughput is predictable.** Every pass handles the oldest-first subset of actionable PRs. The skip logic is correct, so no PR is skipped that could make progress.
6. **The pipeline stays full but not overloaded.** When merged PRs free up capacity, new issues are assigned immediately to refill to `max_open_copilot_prs`.

---

## 2. Problem Statement

The autonomous factory pipeline is supposed to maintain a steady flow:

> issues in queue → Copilot assigned → PR opened → reviewed → merged → repeat

It is making progress — 25 PRs merged in 24 hours — but it is throttled at half capacity and not refilling the work queue. Two hard bugs are preventing steady state. Additional lower-priority bugs will limit scalability as PR volume grows.

---

## 4. Root Cause Analysis

### Bug 1: `findStaleIssues` uses a count heuristic that causes re-kick floods

**File:** `.github/tools/shared/src/run-assignment.ts`  
**Root cause:** The function compares `openPrs.length` to `MAX_COPILOT_PRS` (8). If there are fewer than 8 open PRs, it assumes ALL assigned issues up to the gap are stale and re-kicks them. With 64 assigned issues and 2 open PRs, this means `gap = 6` → re-kicks 6 issues → each spawns a new Copilot session → each session creates a NEW PR on top of whatever existing work the session already had → 62 new PRs.

**The correct logic:** For each assigned issue, check individually whether an open PR exists that targets that issue. An issue is stale only if it is assigned AND has no open PR. Re-kick only up to the capacity gap — and cap per-pass re-kicks to avoid flooding Copilot's session queue.

**Fix:** Build a set of issue numbers that have linked open PRs, then for each assigned issue check membership. See Section 4.1.

---

### Bug 2: `project-manager.agent.md` uses `linkedPullRequests` — a field that does not exist

**File:** `.github/agents/project-manager.agent.md`, Section 3 (Re-kick stale assignments)  
**Root cause:** The agent prompt calls `linkedPullRequests(first:5, states:[OPEN])` on the `Issue` GraphQL type. This field does not exist. The correct approach is to read from the PR side: fetch all open Copilot PRs with `closingIssuesReferences`, build an issue→PR map, then check each assigned issue against that map. Because Copilot does not always include `Fixes #N` in the body, `closingIssuesReferences` is also unreliable. The most reliable source is the Copilot branch naming pattern: Copilot names its branches `copilot/<slug>`, and each branch corresponds to exactly one SWE session. A better heuristic: if an open PR's author is `copilot-swe-agent[bot]` and the PR's `closingIssuesReferences` OR title/body references the issue number, it is linked.

**Fix:** Update the agent prompt to build the issue→PR map from the PR side. See Section 4.2.

---

### Bug 3: `pr-handler.agent.md` has hardcoded bot ID and repo node ID

**File:** `.github/agents/pr-handler.agent.md`, line 152  
**Root cause:** `-f botId="BOT_kgDOC9w8XQ" -f repoId="R_kgDOSx5OCA"` — hardcoded values that silently break if the repo is renamed, transferred, or used as a template. Both values must be looked up at runtime.

**Fix:** Replace hardcoded values with the same dynamic lookup that `run-assignment.ts` uses. See Section 4.3.

---

### Bug 4: PR snapshot query is capped at `first:100`

**File:** `.github/tools/shared/src/pr-snapshot.ts`, line 70  
**Root cause:** With 97 open PRs the query is at 97% capacity. Any additional PRs are silently dropped from the snapshot. The PR handler loop never sees them. They age indefinitely.

**Fix:** Increase to `first:500`. GraphQL will return all PRs up to that limit in a single query. At current scale (97) this is one query; at 500 PRs the response is ~2 MB which fits the existing 16 MB `maxBuffer`. See Section 4.4.

---

### Bug 5: Stage 2b `project-manager` agent does PR review work that Stage 2a already does

**File:** `.github/agents/project-manager.agent.md`, Section 1 ("Clear the queue first")  
**Root cause:** Stage 2b invokes the project-manager agent, and the agent's Section 1 loops over all open Copilot PRs doing draft readiness, conflict checks, CI checks, and merge decisions. Stage 2a already does all of this per-PR in the pr-handler loop. Stage 2b burns its 7-minute budget on duplicate work and never gets to its actual mandate (stale re-kick + new assignment).

**Fix:** Rewrite Stage 2b's prompt to be exclusively: (a) re-kick stale assignments, (b) assign new work to fill capacity. Remove Section 1 entirely from the agent invoked in Stage 2b, or split the agent into two distinct agents with separate mandates.

---

### Bug 6: Stage 0 and Stage 2b both do re-kick logic with different, conflicting approaches

**Files:** `run-assignment.ts` (Stage 0, REKICK_ONLY=true), `project-manager.agent.md` Section 3 (Stage 2b)  
**Root cause:** Stage 0 does programmatic re-kick via count heuristic. Stage 2b's agent also does re-kick via `linkedPullRequests` GraphQL call (which fails — Bug 2). Two re-kick mechanisms that both have bugs and can conflict.

**Fix:** Stage 0 should do the programmatic re-kick correctly (Bug 1 fix). Stage 2b should skip re-kick entirely (its agent prompt should say "Stage 0 already handled stale re-kicks this pass — do NOT re-kick") and focus only on capacity-filling new assignment.

---

### Bug 7: PR handler loop skip logic may be too aggressive

**File:** `.github/tools/shared/src/pr-ordering.ts`  
**Root cause:** Unknown without reading the file. PRs that "have nothing to do" are skipped permanently until next pass. If the skip reason is stale (e.g., a PR was CONFLICTING two passes ago but Copilot has since resolved it), the PR stays skipped and never gets merged.

**Fix:** Read `pr-ordering.ts` and verify skip conditions are re-evaluated on each pass from the snapshot, not cached. PRs should only be skipped if the snapshot shows a condition that CURRENTLY prevents progress.

---

### Bug 8: `action_required` busy-loop risk

**File:** `.github/agents/pr-handler.agent.md`, step 3b  
**Root cause:** The agent prompt correctly says "do NOT `gh run rerun`" for `action_required`. However, if the trusted-actor push also fails to clear it, the agent may retry on every pass. Each retry pushes an empty commit, creating noise and potentially hitting rate limits.

**Fix:** The agent must track whether it already sent a trusted-actor push for `action_required` this session (by checking for the empty commit message `"ci: re-trigger validation"` in recent commits). If yes, do not push again — raise/update the deduped incident and move on.

---

### Bug 9: No progress monitoring — the pipeline reports "success" even when nothing merged

**File:** `pipeline-fast.yml`, step summaries  
**Root cause:** Each stage reports its own exit status but there is no aggregate metric showing: how many PRs were merged this pass, how many are blocked and why, and whether throughput is healthy. This makes it impossible to tell from the workflow summary whether the pipeline is actually working.

**Fix:** Add a final summary step that reports: open PRs at start, merged this pass, newly assigned, re-kicked, and the top 5 blocked PRs with their blocker reason.

---

## 4. Required Changes

### 4.1 Fix `findStaleIssues` — per-issue PR linkage check

**File:** `.github/tools/shared/src/run-assignment.ts`

Replace the count-heuristic approach with per-issue PR linkage detection:

```
Algorithm:
1. Fetch all open issues assigned to copilot-swe-agent[bot] (gh issue list --assignee)
2. Fetch all open PRs from copilot-swe-agent[bot] (gh pr list --author, limit 500)
3. For each open PR, extract: headRefName, closingIssuesReferences numbers, and title
4. Build a Set<issueNumber> of "covered" issues:
   - Any issue number in closingIssuesReferences → covered
   - Any issue number that appears in the PR title or body (best-effort match) → covered
   - Any PR whose headRefName contains the issue number → covered
5. For each assigned issue: if its number is NOT in the covered set → it is stale
6. From stale list: filter to only those where capacity gap exists (openPrs.length < MAX_COPILOT_PRS)
7. Re-kick at most (MAX_COPILOT_PRS - openPrs.length) issues per pass, taking the oldest first
```

**Rate limiting:** Never re-kick more than `MAX_COPILOT_PRS - openPrs.length` issues in a single pass. This is the hard cap. If there are 6 open Copilot PRs and MAX is 8, at most 2 re-kicks happen regardless of how many stale issues exist.

**Why per-issue linkage instead of count heuristic:** The count heuristic assumes that if there are fewer open PRs than assigned issues, the difference are all stale. This is wrong — some PRs may have been merged (issue unassigned), some PRs may have linked issues that aren't reflected in the count. The per-issue check is authoritative.

---

### 4.2 Fix `project-manager.agent.md` Section 3 — remove broken `linkedPullRequests` call

**File:** `.github/agents/project-manager.agent.md`

Replace Section 3 ("Re-kick stale assignments") with this approach:

```
To find stale assigned issues:
1. Get all issues assigned to copilot-swe-agent[bot]:
   gh issue list --state open --assignee "copilot-swe-agent[bot]" --json number,title --limit 100

2. Get all open Copilot PRs with their linked issues:
   gh pr list --author "copilot-swe-agent[bot]" --state open \
     --json number,title,headRefName,closingIssuesReferences --limit 500

3. Build a covered set: for each PR, add all closingIssuesReferences numbers to a set.
   Also pattern-match: if the PR headRefName or title contains "issue-NNN" or "#NNN", add NNN.

4. An assigned issue is stale if its number does not appear in the covered set.

5. Only re-kick if: (open PR count) < max_open_copilot_prs. Re-kick at most
   (max_open_copilot_prs - open PR count) issues per pass.

NOTE: Stage 0 has already run programmatic re-kicks earlier this pass. Check if the issue
already has a re-kick comment from this run before re-kicking again.
```

Remove the 3-per-pass limit (too conservative). Use the capacity-gap limit instead.

---

### 4.3 Fix `pr-handler.agent.md` — remove hardcoded IDs

**File:** `.github/agents/pr-handler.agent.md`, re-kick mutation block

Replace hardcoded `botId` and `repoId` with runtime lookups:

```bash
ISSUE_ID=$(gh api repos/{{ owner }}/{{ repo }}/issues/<number> --jq '.node_id')
BOT_ID=$(gh api graphql \
  -f query='query($o:String!,$r:String!){repository(owner:$o,name:$r){assignableUsers(first:100,query:"Copilot"){nodes{id,login}}}}' \
  -f o="{{ owner }}" -f r="{{ repo }}" \
  --jq '.data.repository.assignableUsers.nodes[]|select(.login=="Copilot")|.id')
REPO_ID=$(gh api repos/{{ owner }}/{{ repo }} --jq '.node_id')
gh api graphql \
  -H 'GraphQL-Features: issues_copilot_assignment_api_support,coding_agent_model_selection' \
  -f query='mutation($issueId:ID!,$botId:ID!,$repoId:ID!,$base:String!) {
    addAssigneesToAssignable(input:{
      assignableId:$issueId, assigneeIds:[$botId],
      agentAssignment:{targetRepositoryId:$repoId, baseRef:$base}
    }) { assignable { ... on Issue { number } } }
  }' \
  -f issueId="$ISSUE_ID" -f botId="$BOT_ID" -f repoId="$REPO_ID" -f base="{{ default_branch }}"
```

---

### 4.4 Fix `pr-snapshot.ts` — increase limit to 500

**File:** `.github/tools/shared/src/pr-snapshot.ts`, line 70

```diff
- pullRequests(states:OPEN, first:100, orderBy:{field:CREATED_AT, direction:ASC}) {
+ pullRequests(states:OPEN, first:500, orderBy:{field:CREATED_AT, direction:ASC}) {
```

At current scale (97 PRs) the response is ~300 KB. At 500 PRs it would be ~1.5 MB — well within the 16 MB `maxBuffer`. If the repo ever exceeds 500 PRs, this query silently truncates again; at that point, add cursor-based pagination.

---

### 4.5 Rewrite Stage 2b agent mandate — assignment only, no PR review

**File:** `pipeline-fast.yml` and `project-manager.agent.md`

Stage 2b should invoke the project-manager agent with a targeted prompt override that scopes it to assignment only:

```
Stage 0 ran earlier this pass and handled programmatic stale re-kicks.
Stage 2a ran and handled per-PR review, CI unblocking, conflict nudges, and merges.

Your job in this Stage 2b pass is ONLY:
1. Assign new ready-for-dev issues to Copilot to fill capacity up to {{ max_open_copilot_prs }}.
2. If Stage 0 re-kicked 0 issues AND there are still stale assigned issues (assigned but no PR,
   verified per-issue via the PR linkage check in your instructions), re-kick those — but only
   up to the capacity gap.

Do NOT re-process open PRs. Do NOT repeat work Stage 2a already did.
Write a brief summary: assigned N issues, re-kicked M stale issues.
```

This is passed as the `prompt` argument to `session.sendAndWait()` in `run-assignment.ts` when `REKICK_ONLY` is false. The agent's system prompt (project-manager.agent.md) retains full context as a reference, but the task-level prompt scopes the work.

---

### 4.6 `pr-ordering.ts` skip logic — already correct, no changes needed

**File:** `.github/tools/shared/src/pr-ordering.ts`

Audited. `planLoop()` skips only one case: a draft PR whose last commit is within the 10-minute settle window (`SETTLE_MINUTES = 10`). Everything else — conflicts, failing CI, changes-requested, needing review — is marked actionable and passed to the agent. There is no cached state, no over-aggressive filtering. This is correct. No changes needed.

---

### 4.7 Add aggregate pipeline health summary step

**File:** `pipeline-fast.yml`

Add a final step (after Stage 5) that always runs:

```yaml
- name: Pipeline health report
  if: always()
  env:
    GH_TOKEN: ${{ secrets.PROJECT_MANAGER_PAT }}
    GITHUB_REPOSITORY: ${{ github.repository }}
  run: |
    OPEN=$(gh pr list --author "copilot-swe-agent[bot]" --state open --json number --jq 'length')
    ASSIGNED=$(gh issue list --assignee "copilot-swe-agent[bot]" --state open --json number --jq 'length')
    MERGED_TODAY=$(gh pr list --author "copilot-swe-agent[bot]" --state merged \
      --search "merged:>=$(date -u -d '1 hour ago' '+%Y-%m-%dT%H:%M:%SZ')" \
      --json number --jq 'length' 2>/dev/null || echo "?")
    {
      echo ""
      echo "## Pipeline health"
      echo "| Metric | Value |"
      echo "|--------|-------|"
      echo "| Open Copilot PRs | $OPEN |"
      echo "| Assigned issues (no PR yet) | $ASSIGNED |"
      echo "| Merged in last hour | $MERGED_TODAY |"
    } >> "$GITHUB_STEP_SUMMARY"
```

---

## 5. Agent Philosophy: Intelligence Over Scripts

The pipeline's long-term health depends on agents that reason rather than scripts that count.

### What the Copilot SDK enables

The pr-handler agent has `gh` tools and can:
- Read PR diffs, CI logs, issue bodies, review comments
- Make judgments about what is blocking a PR and why
- Take targeted action: push an empty commit, update a branch, nudge with specific failure text, re-kick with explanation
- Verify that its action had the intended effect before moving on

This is fundamentally more powerful than hardcoded scripts that pattern-match on counts. An agent can read the actual CI failure log and include the specific error in its `@copilot` nudge. A script just says "CI is failing."

### What agents should NOT do

- Re-derive state they were handed (read the snapshot first)
- Repeat identical actions with no new evidence (nudge once, check for commits, then nudge again only if Copilot responded and there's a new problem)
- Make decisions based on stale information without re-reading
- Take destructive actions (close a PR, re-kick an issue) without logging the evidence

### The right mental model for scale

At 97+ PRs, no agent can handle all of them in one session. The pipeline is correct to use a per-PR loop with a budget. The key insight is **prioritization**:

**Mergeables first.** A PR that is APPROVED + green CI + MERGEABLE takes 10 seconds to merge. Every pass should clear these before doing anything else. Merge 10 PRs in 2 minutes, freeing capacity for new work.

**Then conflicts.** A CONFLICTING PR needs one nudge. Send it and move on. Don't wait.

**Then CI unblocks.** Stale base → `gh pr update-branch`. Cancelled run → `gh run rerun`. These are fast and deterministic.

**Then new reviews.** These take the most time. Only when the fast work is done.

**Then stale issues.** Re-kick only when there's real capacity.

This prioritization should be encoded in `pr-ordering.ts`'s `planLoop()`, not left to the agent to figure out mid-session.

---

## 6. Implementation Priority

Reordered by confirmed impact from live audit:

| Priority | Change | Impact | Evidence |
|----------|--------|--------|----------|
| **P0** | Fix `pr-snapshot.ts` `first:100→500` | 49 PRs permanently invisible | Log shows `"open":50` when 92 exist |
| **P0** | Fix `linkedPullRequests` in `project-manager.agent.md` | Stage 2b errors every run, no assignment | Log shows field error on every pass |
| **P1** | Fix `findStaleIssues` per-issue linkage | Re-kick flood prevention | Prior incident: 62 duplicate PRs |
| **P1** | Scope Stage 2b task prompt to assignment-only | Prevent duplicate PR review work | Stage 2b starts re-doing Stage 2a's work |
| **P1** | Prioritise mergeables first in `pr-ordering.ts` | 3 approved+MERGEABLE PRs unmerged | Confirmed: PRs 225, 234, 247 approved but sat past budget |
| **P2** | Fix hardcoded IDs in `pr-handler.agent.md` | Correctness at scale | `BOT_kgDOC9w8XQ` hardcoded |
| **P2** | Add pipeline health summary step | Observability | Can't see merged/assigned counts without log diving |
| **P3** | `action_required` dedup guard | Noise prevention | Low risk, small benefit |

---

## 7. Scaling the Agents with Custom Tools

**Yes — tools are the right direction, but the design matters enormously.**

The risk with tools is creating a false sense of completeness. If `get_pr_state()` returns a structured snapshot and the agent treats that as the full picture, it will miss everything the snapshot doesn't model: a CI log that reveals a flaky test vs a real regression, a diff that touches more than the linked issue describes, a review comment that refers to a specific line of code and the agent needs to read the diff to understand it. A snapshot-first agent has systematic blind spots.

### The right model: triage fast, investigate thoroughly

Tools should serve **two distinct phases**:

**Phase 1 — Fast triage (structured, cheap)**  
Get the quick read on every PR: is it APPROVED? MERGEABLE? Does it have open specialist lanes? Is CI green? This is where the snapshot is valuable — it answers "what bucket does this PR fall into?" in one call, without wasting agent turns on derivable state.

**Phase 2 — Deep investigation (unstructured, required)**  
For anything that isn't a straightforward terminal action, the agent must *actually look*. Read the diff. Read the CI failure log. Read the issue body. Read the review comments. Understand what changed and why, not just whether a label is present. This cannot be pre-structured — the agent needs raw access to the real content.

The critical rule: **the snapshot opens the investigation; it does not close it.** An agent that reads a snapshot and immediately decides without looking at the diff or logs is as blind as one that has no snapshot at all.

### How the SDK supports custom tools

The `@github/copilot-sdk` has first-class support for custom tools via `defineTool`. Tools are registered on the session at creation time and the SDK handles all invocation routing automatically:

```typescript
import { z } from "zod";
import { defineTool, approveAll } from "@github/copilot-sdk";

const session = await client.createSession({
  model: "gpt-5.4",
  systemPrompt,
  workspacePath: workspace,
  onPermissionRequest: approveAll,   // or per-tool skipPermission: true
  tools: [
    defineTool("assign_to_copilot", {
      description: "Assign an issue to Copilot SWE agent to open a PR",
      parameters: z.object({
        issue_number: z.number().describe("Issue number to assign"),
        reason: z.string().describe("Why this issue is being assigned now"),
      }),
      skipPermission: true,
      handler: async ({ issue_number, reason }) => {
        // implementation here — full Node.js access, gh CLI, etc.
        return { assigned: true, issue: issue_number };
      },
    }),
  ],
});
```

The agent sees `assign_to_copilot` as a named tool it can invoke. The handler runs in the Node.js process with full access to `gh`, GitHub APIs, the filesystem, etc. The agent does not need to know the implementation — it just calls the tool by name with typed parameters.

Tools can return any JSON-serializable value, a string, or a `ToolResultObject` for full control over what the LLM sees vs what's logged.

### Tool design

**`get_pr_triage(pr_number)`** — fast structured read  
Returns structured triage state: mergeable, isDraft, ciState, hasOpenSpecialistLane (array of lane names), approvedBy (array of logins), changesRequestedBy, lastCommitAgeMinutes, linkedIssueNumbers. Implementation calls the batched GraphQL snapshot. Fast. Used to decide which investigation branch to take — NOT to make the final decision. The agent must call investigation tools before any terminal action.

**`get_pr_investigation(pr_number)`** — deep content read, required before any action  
Returns what the agent needs to actually reason: truncated diff (first 200 lines), CI failure log excerpts for each failing check (first 50 lines), linked issue body + acceptance criteria, recent review comment threads with line references, last 3 commit messages and authors. This is not a convenience — it is a required precondition for approve, request-changes, or re-kick. Without it the agent cannot know whether review feedback was addressed or whether the diff is in scope.

**`assign_to_copilot(issue_number, reason)`**  
Encapsulates: bot ID lookup via `assignableUsers` GraphQL, repo node ID via REST, `addAssigneesToAssignable` mutation with `agentAssignment`. Posts the `reason` string as the assignment comment. Read/writeable parameter types prevent hardcoded IDs. The complexity of the mutation lives here, not in agent prompts.

**`rekick_assignment(issue_number, evidence)`**  
Unassign + reassign atomically. The `evidence` parameter is required — the agent must describe what it observed (e.g., "assigned 18h ago, no open PR found, no copilot/ branch exists"). This forces investigation before action. Posts the evidence as a comment so humans can audit the decision.

**`get_stale_assignments()`**  
Returns `{issue_number, title, assigned_hours_ago}[]` for issues assigned to Copilot with no linked open PR — using the correct per-issue linkage check (not a count heuristic). The agent gets a clean list and can triage each one. The Bug 1 fix lives entirely here.

**`merge_pr(pr_number, rationale)`**  
`gh pr merge --squash --delete-branch` with confirmation. Returns merge commit SHA. `rationale` is required — the agent must state why it's merging (e.g., "approved by ianreay, CI green, MERGEABLE, no specialist lanes").

**`post_review(pr_number, action, body)`**  
`action`: `"approve"` | `"request_changes"`. For `request_changes`, enforces that body starts with `@copilot` (coding agent wake). Deduplication guard: checks if an identical review exists with no commits since — if so, returns `{skipped: true, reason: "already posted"}` instead of posting again. Prevents the busy-loop bug at the tool layer.

**`update_pr_branch(pr_number)`**  
`gh pr update-branch` for stale-base CI failures and `action_required` re-trigger. Records whether it was already up-to-date so the agent knows to escalate vs wait.

### What tools do NOT replace

- Reading the diff: `gh pr diff <number>` must be called before any review decision
- Reading CI logs: `gh run view <id> --log` for failing checks — the agent must see the actual failure, not just "failing"
- Reading the issue body: `gh issue view <number>` to understand acceptance criteria
- Judgment on whether feedback was addressed, whether scope is appropriate, whether a test is meaningful

The agent's intelligence is in that judgment. Tools make the mechanical actions reliable and the state reading cheap. They don't substitute for the agent actually understanding what it's looking at.

### What unexpected scenarios look like — and how the agent handles them

**Scenario: CI is "failing" but the snapshot only shows a red dot**  
With tools, the agent calls `get_pr_triage()` → sees `ciState: "FAILURE"` → calls `get_pr_investigation()` → reads the CI log excerpt → sees it's a known flaky test unrelated to this PR's changes → calls `gh run rerun` to retry rather than nagging Copilot with "please fix CI". Without investigation, the agent would post an irrelevant nudge.

**Scenario: PR has APPROVED review but the diff shows it added a security-relevant endpoint**  
Triage says "approved, mergeable, no specialist lane" → agent calls `get_pr_investigation()` → reads the diff → sees a new unauthenticated endpoint → adds `needs-security-review` label instead of merging. The snapshot alone would have caused an incorrect auto-merge.

**Scenario: Stage 0 re-kicked an issue that actually has a PR with a non-standard body**  
`get_stale_assignments()` implementation cross-references all open Copilot PRs including branch name pattern matching, not just `closingIssuesReferences`. The issue correctly doesn't appear as stale. No spurious re-kick.

**Scenario: A changes-requested review is from 3 days ago and Copilot pushed 10 commits since**  
Triage sees `changesRequestedBy: ["ianreay"]` — but the agent calls `get_pr_investigation()` which includes the last 3 commit messages and the review thread. It sees Copilot has already responded and re-addressed the feedback. The agent re-reviews the diff against the original request, reaches a verdict, and either approves or posts a new specific concern. It does not repeat the old nudge.

### Why investigation tools matter more than action tools

The action tools (`merge_pr`, `assign_to_copilot`) are conveniences that prevent mechanical bugs. The investigation tools (`get_pr_investigation`) are what make the agent genuinely intelligent. The current pr-handler agent already has `gh` access and could call these investigation commands — but the agent prompt doesn't consistently require it. The tool design should make deep investigation the expected default path, not an optional step.

**Design principle:** A tool call that takes an action (`merge`, `approve`, `rekick`) should be impossible to invoke without a prior investigation call for that PR in the same session. Enforce this at the tool layer by requiring the agent to pass a brief `rationale` string — which forces it to have read something before acting. An agent that cannot produce a rationale has not investigated.

---

## 8. What "Done" Looks Like

The pipeline is solved when:

1. **Every pass:** PRs that are APPROVED + green CI + MERGEABLE are merged. No exceptions, no budget truncation before they're handled (mergeables sort first).
2. **Every pass:** Stage 2b assigns new issues to fill capacity to 8, without error. No more `linkedPullRequests` failures.
3. **Every pass:** All 92+ open PRs are in the snapshot — none invisible due to query truncation.
4. **Every pass:** At least `floor(PIPELINE_BUDGET_MS / PER_PR_TIMEOUT_MS)` PRs are processed, oldest-first, highest-priority-first within that.
5. **After merges:** Freed capacity is refilled within the next pass. The pipeline never idles.
6. **Observability:** Workflow step summaries show merged count, assigned count, re-kicked count, top blockers — without reading raw logs.
7. **No PR ages past 48 hours** without a pipeline comment explaining the specific blocker.
