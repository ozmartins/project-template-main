export interface GitHubContext {
  owner: string;
  repo: string;
  repository: string;
  runId: string;
  runUrl: string;
  serverUrl: string;
  workspace: string;
  eventName: string;
}

export function getGitHubContext(): GitHubContext {
  const repository = process.env["GITHUB_REPOSITORY"] ?? "";
  const serverUrl = process.env["GITHUB_SERVER_URL"] ?? "https://github.com";
  const runId = process.env["GITHUB_RUN_ID"] ?? "";
  const [owner = "", repo = ""] = repository.split("/");

  return {
    owner,
    repo,
    repository,
    runId,
    runUrl: runId ? `${serverUrl}/${repository}/actions/runs/${runId}` : "(local)",
    serverUrl,
    workspace: process.env["GITHUB_WORKSPACE"] ?? process.cwd(),
    eventName: process.env["GITHUB_EVENT_NAME"] ?? "unknown",
  };
}
