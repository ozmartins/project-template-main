import { appendFileSync } from "node:fs";

export interface ContractFinding {
  kind: string;
  message: string;
}

function appendSummary(markdown: string): void {
  process.stdout.write(`${markdown}\n`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    appendFileSync(summary, `${markdown}\n`, "utf-8");
  }
}

function pickToken(): string | undefined {
  return process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
}

function repositoryContext(): { owner: string; repo: string } | null {
  const value = process.env.GITHUB_REPOSITORY;
  if (!value || !value.includes("/")) return null;
  const [owner, repo] = value.split("/", 2);
  if (!owner || !repo) return null;
  return { owner, repo };
}

async function hasOpenIssue(
  owner: string,
  repo: string,
  title: string,
  labels: string[],
  token: string
): Promise<boolean> {
  const url = new URL(`https://api.github.com/repos/${owner}/${repo}/issues`);
  url.searchParams.set("state", "open");
  if (labels.length > 0) {
    url.searchParams.set("labels", labels.join(","));
  }
  url.searchParams.set("per_page", "100");

  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(`Issue list failed: HTTP ${response.status}`);
  }

  const issues = (await response.json()) as Array<{ title?: string; pull_request?: unknown }>;
  return issues.some((issue) => !issue.pull_request && issue.title === title);
}

async function createIssue(
  owner: string,
  repo: string,
  title: string,
  body: string,
  labels: string[],
  token: string
): Promise<void> {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title, body, labels }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Issue create failed: HTTP ${response.status} ${text.slice(0, 300)}`);
  }
}

export async function fileIssueIfNeeded(args: {
  title: string;
  labels: string[];
  intro: string;
  findings: ContractFinding[];
}): Promise<void> {
  if (args.findings.length === 0) return;

  const token = pickToken();
  const repo = repositoryContext();
  if (!token || !repo) {
    appendSummary("⚠️ Contract drift issue filing skipped (missing GH token or GITHUB_REPOSITORY).");
    return;
  }

  try {
    const exists = await hasOpenIssue(repo.owner, repo.repo, args.title, args.labels, token);
    if (exists) {
      appendSummary(
        `ℹ️ Existing open issue found for \`${args.title}\`; skipping duplicate creation.`
      );
      return;
    }

    const runUrl = process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : "(run URL unavailable)";
    const bullets = args.findings
      .map((finding) => `- **${finding.kind}**: ${finding.message}`)
      .join("\n");

    await createIssue(
      repo.owner,
      repo.repo,
      args.title,
      `${args.intro}\n\n${bullets}\n\nRun: ${runUrl}`,
      args.labels,
      token
    );

    appendSummary(`⚠️ Created issue: \`${args.title}\``);
  } catch (error) {
    appendSummary(`⚠️ Contract drift issue creation failed: ${(error as Error).message}`);
  }
}

export function summarizeFindings(title: string, findings: ContractFinding[]): void {
  appendSummary(`### ${title}`);
  if (findings.length === 0) {
    appendSummary("✅ No drift detected.");
    return;
  }

  appendSummary(`⚠️ Detected **${findings.length}** finding(s):`);
  for (const finding of findings) {
    appendSummary(`- **${finding.kind}**: ${finding.message}`);
  }
}
