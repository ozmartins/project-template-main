#!/usr/bin/env bash
# Bootstrap all factory labels for <ORG>/<REPO_NAME>
# Usage: GH_TOKEN=<pat> ./scripts/bootstrap-labels.sh [owner/repo]
set -euo pipefail

REPO="${1:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
echo "Bootstrapping labels for: $REPO"

create_label() {
  local name="$1" color="$2" description="$3"
  gh label create "$name" --repo "$REPO" --color "$color" --description "$description" --force
}

echo "--- Type labels ---"
create_label "bug"            "d73a4a" "Something isn't working"
create_label "enhancement"    "a2eeef" "New feature or request"
create_label "documentation"  "0075ca" "Improvements or additions to documentation"
create_label "security"       "e4e669" "Security concern or audit item"
create_label "performance"    "f9d0c4" "Performance improvement"
create_label "refactor"       "c5def5" "Code refactoring without behavior change"
create_label "infrastructure" "bfdadc" "Infrastructure and tooling"

echo "--- Queue labels ---"
create_label "queue:product"       "fbca04" "Owner: Product Owner"
create_label "queue:architecture"  "e4e669" "Owner: Factory Architect"
create_label "queue:development"   "0075ca" "Owner: Project Coordinator / Copilot"
create_label "queue:review"        "c5def5" "Owner: Tech Reviewer"
create_label "queue:qa"            "bfdadc" "Owner: QA Manager"
create_label "queue:security"      "d93f0b" "Owner: Security Reviewer"
create_label "queue:database"      "0052cc" "Owner: Database Steward"
create_label "queue:platform"      "5319e7" "Owner: Platform Engineer"
create_label "queue:release"       "0e8a16" "Owner: Release Manager"
create_label "queue:ops"           "b60205" "Owner: Operations"
create_label "queue:docs"          "cfd3d7" "Owner: Docs Improver"
create_label "user-docs"           "1d76db" "End-user docs lane (User Docs Manager)"

echo "--- State labels ---"
create_label "needs-triage"          "e4e669" "Awaiting Product Owner triage"
create_label "needs-info"            "d93f0b" "Blocked on clarification"
create_label "needs-design"          "f9d0c4" "Requires architecture design first"
create_label "design-in-progress"    "c5def5" "Architect is working the design"
create_label "design-approved"       "0e8a16" "Design is sufficient for implementation"
create_label "ready-for-dev"         "0075ca" "Clear acceptance criteria; ready to assign"
create_label "assigned-to-copilot"   "a2eeef" "Copilot cloud agent is assigned"
create_label "in-progress"           "fbca04" "Actively being worked"
create_label "ready-for-review"      "bfdadc" "PR exists; validation running or complete"
create_label "changes-requested"     "d93f0b" "Review found actionable fixes"
create_label "ready-for-release"     "0e8a16" "Merged and validated for release"
create_label "released"              "0e8a16" "Production release completed"
create_label "blocked"               "b60205" "Cannot progress; waiting on dependency"

echo "--- Priority labels ---"
create_label "priority:critical" "b60205" "Must fix immediately"
create_label "priority:high"     "d93f0b" "High priority"
create_label "priority:medium"   "fbca04" "Medium priority"
create_label "priority:low"      "cfd3d7" "Low priority"

echo "--- Agent / automation labels ---"
create_label "agent:run"           "c5def5" "Trigger an agent run manually"
create_label "ai-fix-requested"    "a2eeef" "Human requested AI fix"
create_label "ai-fix-approved"     "0e8a16" "AI fix has been approved"
create_label "auto:alert"          "d73a4a" "Created by automated monitoring"
create_label "auto:process"        "e4e669" "Factory process pattern roll-up from nightly PR review"

echo "--- Specialist review labels ---"
create_label "needs-security-review"   "d93f0b" "Requires security review before merging"
create_label "security-reviewed"       "0e8a16" "Security review complete"
create_label "needs-database-review"   "0052cc" "Requires database/migration review"
create_label "database-reviewed"       "0e8a16" "Database review complete"
create_label "needs-platform-review"   "5319e7" "Requires platform/workflow review"
create_label "platform-reviewed"       "0e8a16" "Platform review complete"
create_label "needs-adr"               "5319e7" "Missing ADR for architectural decision"
create_label "requires-maintainer-review" "b60205" "Human maintainer must review"

echo "--- Quality labels ---"
create_label "needs-tests"   "d93f0b" "Missing test coverage"
create_label "qa-reviewed"   "0e8a16" "QA Manager has reviewed"
create_label "test-gap"      "f9d0c4" "Identified test coverage gap"

echo "--- Risk labels ---"
create_label "risk:low"    "0e8a16" "Low risk change"
create_label "risk:medium" "fbca04" "Medium risk change"
create_label "risk:high"   "d93f0b" "High risk change"

echo ""
echo "✅ Done. All labels created/updated in $REPO."
