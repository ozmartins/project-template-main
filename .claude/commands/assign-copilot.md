# /assign-copilot

Assign the GitHub Copilot coding agent to an issue using the REST API.

## Usage

```
/assign-copilot <issue-number>
```

## What this command does

Runs the REST one-liner that assigns `Copilot` to the given issue number. This is sufficient for ad-hoc manual assignment. The factory's project-manager agent uses the full GraphQL mutation (see `.github/agents/project-manager.agent.md`) when it needs to start a Copilot session from a clean base checkout.

## Implementation

```bash
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
gh api "repos/$REPO/issues/$ARGUMENTS/assignees" -X POST --field 'assignees[]=Copilot'
echo "Copilot assigned to issue #$ARGUMENTS in $REPO"
```
