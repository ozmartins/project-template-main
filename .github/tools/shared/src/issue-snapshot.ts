#!/usr/bin/env node
/**
 * issue-snapshot.ts — batched open-issue state for the backlog review loop.
 *
 * A single paginated GraphQL query fetches every open issue ordered by
 * updatedAt ASC — oldest-updated first — so the most stale issues are
 * handed to the reviewer before any wall-clock budget expires. This mirrors
 * the strategy in pr-snapshot.ts (oldest-created-at first for PRs).
 *
 * Two roles:
 *   - library: `fetchIssueSnapshots(ctx)` → `IssueSnapshot[]` for the loop.
 *   - CLI: `tsx issue-snapshot.ts [--issue N]` prints snapshots so the agent
 *     can re-fetch authoritative state mid-session.
 */

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { getGitHubContext, type GitHubContext } from "./github-context.js";

export interface IssueSnapshot {
  number: number;
  title: string;
  /** Truncated to 4000 chars. Agent uses `gh issue view <N>` for full body. */
  body: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  labels: string[];
  assignees: string[];
  milestone: string | null;
  commentCount: number;
}

export const ISSUE_SNAPSHOT_QUERY = `
query($owner:String!, $repo:String!, $cursor:String) {
  repository(owner:$owner, name:$repo) {
    issues(states:OPEN, first:100, after:$cursor, orderBy:{field:UPDATED_AT, direction:ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title body state createdAt updatedAt
        author { login }
        labels(first:20) { nodes { name } }
        assignees(first:5) { nodes { login } }
        milestone { title }
        comments { totalCount }
      }
    }
  }
}`;

interface RawIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  author: { login: string } | null;
  labels: { nodes: { name: string }[] };
  assignees: { nodes: { login: string }[] };
  milestone: { title: string } | null;
  comments: { totalCount: number };
}

interface RawResponse {
  data?: {
    repository?: {
      issues?: {
        pageInfo?: { hasNextPage: boolean; endCursor: string | null };
        nodes?: RawIssue[];
      };
    };
  };
}

const BODY_TRUNCATE = 4000;

export function parseIssueSnapshots(raw: RawResponse): IssueSnapshot[] {
  const nodes = raw.data?.repository?.issues?.nodes ?? [];
  return nodes.map((issue): IssueSnapshot => ({
    number: issue.number,
    title: issue.title,
    body: (issue.body ?? "").slice(0, BODY_TRUNCATE),
    author: issue.author?.login ?? "unknown",
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    labels: (issue.labels?.nodes ?? []).map((l) => l.name),
    assignees: (issue.assignees?.nodes ?? []).map((a) => a.login),
    milestone: issue.milestone?.title ?? null,
    commentCount: issue.comments?.totalCount ?? 0,
  }));
}

export function fetchIssueSnapshots(ctx: GitHubContext): IssueSnapshot[] {
  const allNodes: RawIssue[] = [];
  let cursor: string | null = null;

  for (;;) {
    const args = [
      "api", "graphql",
      "-f", `owner=${ctx.owner}`,
      "-f", `repo=${ctx.repo}`,
      "-f", `query=${ISSUE_SNAPSHOT_QUERY}`,
    ];
    if (cursor) {
      args.push("-f", `cursor=${cursor}`);
    }
    const out = execFileSync("gh", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    const page = JSON.parse(out) as RawResponse;
    const connection = page.data?.repository?.issues;
    allNodes.push(...(connection?.nodes ?? []));

    const pageInfo = connection?.pageInfo;
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
    cursor = pageInfo.endCursor;
  }

  return parseIssueSnapshots({
    data: { repository: { issues: { nodes: allNodes } } },
  });
}

function main(): void {
  const argv = process.argv.slice(2);
  const issueFlag = argv.indexOf("--issue");
  const wantIssue =
    issueFlag !== -1 && argv[issueFlag + 1] ? Number(argv[issueFlag + 1]) : undefined;

  const ctx = getGitHubContext();
  const snapshots = fetchIssueSnapshots(ctx);
  const result = wantIssue ? snapshots.filter((s) => s.number === wantIssue) : snapshots;
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
