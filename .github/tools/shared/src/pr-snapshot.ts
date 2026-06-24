#!/usr/bin/env node
/**
 * pr-snapshot.ts — batched, one-pass open-PR state for the PR pipeline loop.
 *
 * A single `gh api graphql` query fetches every open PR with the fields the
 * per-PR agent needs (reviews, CI rollup, labels, conflict state, linked
 * issues, commit/review timing). This replaces the per-PR exploratory `gh`
 * chains that made the old monolithic Project Manager session re-derive all
 * state from scratch (24 turns, 23k→96k tokens, killed mid-sweep).
 *
 * Two roles:
 *   - library: `fetchPrSnapshots(ctx)` → `PrSnapshot[]` for the orchestrator.
 *   - CLI: `tsx pr-snapshot.ts --json [--pr N]` prints the snapshot(s) so a
 *     per-PR agent can (re)read authoritative state with ONE reliable call
 *     instead of composing fragile `gh` incantations.
 *
 * The query parsing (`parsePrSnapshots`) is a pure function so it is unit
 * tested against a captured fixture — no network in tests.
 */

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { getGitHubContext, type GitHubContext } from "./github-context.js";

export interface PrReview {
  state: string; // APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED | PENDING
  author: string;
  submittedAt: string | null;
}

export interface PrCheck {
  name: string;
  /** CheckRun status (QUEUED/IN_PROGRESS/COMPLETED) or "STATUS" for legacy status contexts. */
  status: string | null;
  /** Normalised conclusion: SUCCESS|FAILURE|CANCELLED|ACTION_REQUIRED|NEUTRAL|… or null while running. */
  conclusion: string | null;
}

export interface PrSnapshot {
  number: number;
  title: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  isDraft: boolean;
  /** GitHub mergeable enum: MERGEABLE | CONFLICTING | UNKNOWN. */
  mergeable: string;
  /** Only populated under branch protection; usually null here — derive from reviews instead. */
  reviewDecision: string | null;
  changedFiles: number;
  labels: string[];
  /** Most recent review overall (chronological last), or null. */
  latestReview: PrReview | null;
  /** True if the latest review from any reviewer is APPROVED. */
  approved: boolean;
  /** True if the latest review from any reviewer is CHANGES_REQUESTED. */
  changesRequested: boolean;
  /** ISO timestamp of the most recent commit, or null. */
  lastCommitAt: string | null;
  /** Aggregate CI rollup: SUCCESS|FAILURE|PENDING|ERROR|EXPECTED, or null when no checks. */
  ciState: string | null;
  checks: PrCheck[];
  linkedIssues: number[];
}

/** GraphQL: one page of open PRs with cursor support (max 100 per page). */
export const PR_SNAPSHOT_QUERY = `
query($owner:String!, $repo:String!, $cursor:String) {
  repository(owner:$owner, name:$repo) {
    pullRequests(states:OPEN, first:100, after:$cursor, orderBy:{field:CREATED_AT, direction:ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title createdAt updatedAt isDraft mergeable reviewDecision changedFiles
        author { login }
        labels(first:30) { nodes { name } }
        reviews(last:20) { nodes { state author { login } submittedAt } }
        commits(last:1) { nodes { commit {
          committedDate
          statusCheckRollup { state
            contexts(first:50) { nodes {
              __typename
              ... on CheckRun { name status conclusion }
              ... on StatusContext { context state }
            } }
          }
        } } }
        closingIssuesReferences(first:10) { nodes { number } }
      }
    }
  }
}`;

interface RawReview {
  state: string;
  author: { login: string } | null;
  submittedAt: string | null;
}

interface RawContext {
  __typename: string;
  name?: string;
  status?: string | null;
  conclusion?: string | null;
  context?: string;
  state?: string;
}

interface RawPr {
  number: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  isDraft: boolean;
  mergeable: string;
  reviewDecision: string | null;
  changedFiles: number;
  author: { login: string } | null;
  labels: { nodes: { name: string }[] };
  reviews: { nodes: RawReview[] };
  commits: {
    nodes: {
      commit: {
        committedDate: string;
        statusCheckRollup: { state: string; contexts: { nodes: RawContext[] } } | null;
      };
    }[];
  };
  closingIssuesReferences: { nodes: { number: number }[] };
}

interface RawResponse {
  data?: {
    repository?: {
      pullRequests?: {
        pageInfo?: { hasNextPage: boolean; endCursor: string | null };
        nodes?: RawPr[];
      };
    };
  };
}

function normaliseChecks(contexts: RawContext[]): PrCheck[] {
  return contexts.map((c) => {
    if (c.__typename === "StatusContext") {
      // Legacy commit-status: map its state into the conclusion slot.
      return { name: c.context ?? "status", status: "STATUS", conclusion: c.state ?? null };
    }
    return { name: c.name ?? "check", status: c.status ?? null, conclusion: c.conclusion ?? null };
  });
}

/**
 * Latest review per author (reviews arrive chronologically). APPROVED /
 * CHANGES_REQUESTED only count when they are an author's *most recent* review,
 * so a stale CHANGES_REQUESTED that was followed by an APPROVED from the same
 * reviewer does not keep the PR blocked.
 */
function latestReviewByAuthor(reviews: PrReview[]): Map<string, PrReview> {
  const byAuthor = new Map<string, PrReview>();
  for (const r of reviews) {
    // Ignore pure COMMENTED/PENDING when deciding approve/block state.
    if (r.state === "APPROVED" || r.state === "CHANGES_REQUESTED" || r.state === "DISMISSED") {
      byAuthor.set(r.author, r);
    }
  }
  return byAuthor;
}

/** Pure: map a raw GraphQL response into typed snapshots (unit tested via fixture). */
export function parsePrSnapshots(raw: RawResponse): PrSnapshot[] {
  const nodes = raw.data?.repository?.pullRequests?.nodes ?? [];
  return nodes.map((pr): PrSnapshot => {
    const reviews: PrReview[] = (pr.reviews?.nodes ?? []).map((r) => ({
      state: r.state,
      author: r.author?.login ?? "unknown",
      submittedAt: r.submittedAt,
    }));
    const decisive = latestReviewByAuthor(reviews);
    const approved = [...decisive.values()].some((r) => r.state === "APPROVED");
    const changesRequested = [...decisive.values()].some((r) => r.state === "CHANGES_REQUESTED");

    const commit = pr.commits?.nodes?.[0]?.commit;
    const rollup = commit?.statusCheckRollup ?? null;

    return {
      number: pr.number,
      title: pr.title,
      author: pr.author?.login ?? "unknown",
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
      isDraft: pr.isDraft,
      mergeable: pr.mergeable,
      reviewDecision: pr.reviewDecision,
      changedFiles: pr.changedFiles,
      labels: (pr.labels?.nodes ?? []).map((l) => l.name),
      latestReview: reviews.length > 0 ? reviews[reviews.length - 1]! : null,
      approved,
      changesRequested,
      lastCommitAt: commit?.committedDate ?? null,
      ciState: rollup?.state ?? null,
      checks: normaliseChecks(rollup?.contexts?.nodes ?? []),
      linkedIssues: (pr.closingIssuesReferences?.nodes ?? []).map((i) => i.number),
    };
  });
}

/** Run the paginated GraphQL query via `gh` and return all open PR snapshots (oldest-first). */
export function fetchPrSnapshots(ctx: GitHubContext): PrSnapshot[] {
  const allNodes: RawPr[] = [];
  let cursor: string | null = null;

  for (;;) {
    const args = [
      "api", "graphql",
      "-f", `owner=${ctx.owner}`,
      "-f", `repo=${ctx.repo}`,
      "-f", `query=${PR_SNAPSHOT_QUERY}`,
    ];
    if (cursor) {
      args.push("-f", `cursor=${cursor}`);
    }
    const out = execFileSync("gh", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    const page = JSON.parse(out) as RawResponse;
    const connection = page.data?.repository?.pullRequests;
    allNodes.push(...(connection?.nodes ?? []));

    const pageInfo = connection?.pageInfo;
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
    cursor = pageInfo.endCursor;
  }

  // Wrap collected nodes in the shape parsePrSnapshots expects.
  return parsePrSnapshots({
    data: { repository: { pullRequests: { nodes: allNodes } } },
  });
}

function main(): void {
  const argv = process.argv.slice(2);
  const prFlag = argv.indexOf("--pr");
  const wantPr = prFlag !== -1 && argv[prFlag + 1] ? Number(argv[prFlag + 1]) : undefined;

  const ctx = getGitHubContext();
  const snapshots = fetchPrSnapshots(ctx);
  const result = wantPr ? snapshots.filter((s) => s.number === wantPr) : snapshots;
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
