# /triage-board

Audit the GitHub project board for hierarchy gaps and fix them. Detects orphaned issues (no epic parent), duplicate epics/initiatives, and project items missing Priority/Phase/Type fields. Repairs what it can automatically; files a summary issue for anything requiring human judgement.

## Usage

```
/triage-board
/triage-board --repo Volaris-AI/project-template --project 18
/triage-board --dry-run        # report only, no writes
```

## What this skill does

**Phase 1 — Audit**

1. Fetch all open issues from the repo
2. Fetch all items in the project board (project #18 by default)
3. Fetch sub-issue assignments for every epic and initiative
4. Identify:
   - **Orphaned issues** — open, non-epic/initiative issues with no parent epic
   - **Issues not on the board** — open issues missing from the project entirely
   - **Board items missing fields** — items with no Priority, Phase, or Item Type set
   - **Duplicate epics** — multiple open epics covering the same theme (detected by title similarity and overlapping child sets)
   - **Closed issues still listed as parents** — closed epics/initiatives still holding sub-issue links (GitHub API limitation; flag for human review)
   - **Epics with no children** — empty epics that may be stale

**Phase 2 — Fix (unless --dry-run)**

For each orphaned issue:
- Infer the correct epic from the issue's labels (`queue:security` → Epic #38 or #50/53; `queue:platform` → #51/54; etc.)
- Use `gh api -X POST repos/{repo}/issues/{epic}/sub_issues --input - <<< '{"sub_issue_id": <db_id>}'` to assign
- Add the issue to the project board if missing
- Set Priority and Item Type fields based on existing labels

**Phase 3 — Report**

Post a summary to stdout and, if any items required human judgement (ambiguous epic assignment, duplicate epics), open a GitHub issue tagged `needs-triage` with the full findings.

## Implementation

Run the following steps:

### Step 1 — Collect state

```bash
# All open issues
gh issue list --repo $REPO --state open --limit 100 --json number,title,labels,parentIssue

# All items currently in the project
gh project item-list $PROJECT_NUM --owner $ORG --format json --jq '.items[]'

# Sub-issues for each known epic/initiative
EPICS=(15 16 17 38 50 51 52 53 54 55)  # update when new epics are created
for epic in "${EPICS[@]}"; do
  gh api "repos/$REPO/issues/$epic/sub_issues" --jq '[.[].number]'
done
```

### Step 2 — Compute orphans

```bash
# Issues that are not: epics, initiatives, or children of any epic
# Cross-reference the children lists above against all open issues
```

### Step 3 — Infer epic from labels

Label → Epic mapping (update when new epics are created):
| Labels | Epic |
|---|---|
| `queue:security`, `needs-security-review` | #38 (OSS scanning) or #50 (container) or #52 (secrets) or #53 (supply chain) — pick by title keywords |
| `queue:platform`, `needs-platform-review` | #51 (K8s) or #54 (observability) |
| `queue:security` + title contains "docker\|container\|image\|dockerfile" | #50 |
| `queue:security` + title contains "secret\|vault\|bao\|eso" | #52 |
| `queue:security` + title contains "slsa\|sbom\|sign\|sha\|pin\|supply" | #53 |
| `queue:security` + title contains "scan\|sast\|cve\|licence\|license\|gitleaks\|trivy\|semgrep\|osv" | #38 |
| `queue:platform` + title contains "network\|service.account\|hpa\|pdb\|k8s\|kubernetes\|helm" | #51 |
| `queue:platform` + title contains "observ\|metric\|log\|trac\|grafana\|prometheus" | #54 |
| `queue:security` (default, no keyword match) | #38 |
| no queue label, title contains "quality\|coverage\|typecheck\|lint" | #55 |
| no queue label, title contains "doc\|readme\|adr" | #17 |
| no queue label, ci/fix labels | #16 |

### Step 4 — Assign sub-issues

```bash
# Get the issue's database ID first (sub_issues API requires db_id, not issue number)
db_id=$(gh api "repos/$REPO/issues/$ISSUE_NUM" --jq '.id')
gh api -X POST "repos/$REPO/issues/$EPIC_NUM/sub_issues" \
  --input - <<< "{\"sub_issue_id\": $db_id}"
```

### Step 5 — Add missing board items

```bash
gh project item-add $PROJECT_NUM --owner $ORG \
  --url "https://github.com/$REPO/issues/$ISSUE_NUM"
```

### Step 6 — Set missing fields

```bash
# Get item ID from the board
item_id=$(gh project item-list $PROJECT_NUM --owner $ORG --format json \
  --jq ".items[] | select(.content.number == $ISSUE_NUM) | .id")

# Set Priority field (PVTSSF_lADODKSoyc4BbNXlzhV_hks)
# Set Phase field (PVTSSF_lADODKSoyc4BbNXlzhV_hnM)
# Set Item Type field (PVTSSF_lADODKSoyc4BbNXlzhV_jaw)
# Values derived from labels: priority:high → 6d03bfbe, priority:medium → 572ff22c, priority:low → 5e9a4671
```

### Step 7 — Report

Print a table:

```
ORPHANS FIXED:
  #XX  <title>  → assigned to Epic #YY

ISSUES ADDED TO BOARD:
  #XX  <title>

FIELDS SET:
  #XX  Priority=High, Phase=Phase 4, Item Type=Story

NEEDS HUMAN REVIEW:
  #XX  <title>  — could not infer epic (no matching labels/keywords)

DUPLICATE EPICS (manual dedup needed):
  #AA vs #BB — both cover <theme>

EMPTY EPICS (may be stale):
  #CC  <title>  — 0 children
```

## Key IDs (project-template, project #18)

```
REPO=Volaris-AI/project-template
ORG=Volaris-AI
PROJECT_NUM=18
PROJECT_ID=PVT_kwDODKSoyc4BbNXl

# Fields
PRIORITY_FIELD=PVTSSF_lADODKSoyc4BbNXlzhV_hks
PHASE_FIELD=PVTSSF_lADODKSoyc4BbNXlzhV_hnM
TYPE_FIELD=PVTSSF_lADODKSoyc4BbNXlzhV_jaw
STATUS_FIELD=PVTSSF_lADODKSoyc4BbNXlzhV_hPg

# Priority option IDs
PRIORITY_CRITICAL=28d59fbc
PRIORITY_HIGH=6d03bfbe
PRIORITY_MEDIUM=572ff22c
PRIORITY_LOW=5e9a4671

# Phase option IDs
PHASE_1=b213ca3d  # Container Security
PHASE_2=f3b4645c  # Secrets & Supply Chain
PHASE_3=08aba5c5  # Kubernetes Hardening
PHASE_4=dee75957  # Code Quality
PHASE_5=a90eb482  # Observability

# Item Type option IDs
TYPE_INITIATIVE=f9c4569e
TYPE_EPIC=4d2a95dc
TYPE_STORY=596f9263

# Known epics (issue number → theme)
INITIATIVE=15
EPICS_CI=16
EPICS_DOCS=17
EPICS_OSS_SCAN=38
EPICS_CONTAINER=50
EPICS_K8S=51
EPICS_SECRETS=52
EPICS_SUPPLY_CHAIN=53
EPICS_OBSERVABILITY=54
EPICS_QUALITY=55
```
