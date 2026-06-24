import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import {
  listChangedDefinitionFiles,
  loadDefinitionFile,
  renderDslDefinitionChangesComment,
  summariseDefinitionChange,
  type PullRequestFile,
} from "./dsl-definition-summary.js";

function parseArgs(): { filesPath: string; workspace: string } {
  const args = process.argv.slice(2);
  const filesIndex = args.indexOf("--files");
  if (filesIndex === -1 || !args[filesIndex + 1]) {
    throw new Error("Missing required --files argument");
  }
  const workspaceIndex = args.indexOf("--workspace");
  if (workspaceIndex !== -1 && !args[workspaceIndex + 1]) {
    throw new Error("Missing value for --workspace");
  }
  const workspace = workspaceIndex === -1 ? process.cwd() : args[workspaceIndex + 1];
  return { filesPath: args[filesIndex + 1], workspace };
}

function main(): void {
  const { filesPath, workspace } = parseArgs();
  const rawFiles = readFileSync(filesPath, "utf8");
  const files = JSON.parse(rawFiles) as PullRequestFile[];
  const definitionFiles = listChangedDefinitionFiles(files);

  const summaries = definitionFiles.map((file) => {
    const absolute = resolve(workspace, file.filename);
    const content = file.status === "removed" || !existsSync(absolute) ? undefined : loadDefinitionFile(absolute);
    return summariseDefinitionChange(file, content);
  });

  process.stdout.write(renderDslDefinitionChangesComment(summaries));
}

main();
