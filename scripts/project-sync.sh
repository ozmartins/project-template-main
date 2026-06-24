#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FACTORY_CONFIG_PATH="${FACTORY_CONFIG_PATH:-$REPO_ROOT/.github/factory.yml}"

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

read_repo_field() {
  local field="$1"
  awk -v target="$field" '
    /^repository:[[:space:]]*$/ { in_repo=1; next }
    in_repo && /^[^[:space:]]/ { in_repo=0 }
    in_repo && $1 == target ":" {
      $1=""
      sub(/^[[:space:]]+/, "", $0)
      print $0
      exit
    }
  ' "$FACTORY_CONFIG_PATH"
}

normalize_scalar() {
  local value="$1"
  value="${value%%#*}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  fi
  if [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

ensure_config() {
  if [[ ! -f "$FACTORY_CONFIG_PATH" ]]; then
    echo "Factory config not found at: $FACTORY_CONFIG_PATH" >&2
    exit 1
  fi

  REPO_OWNER="$(normalize_scalar "$(read_repo_field owner)")"
  REPO_NAME="$(normalize_scalar "$(read_repo_field name)")"
  PROJECT_OWNER="$(normalize_scalar "$(read_repo_field project_owner)")"
  PROJECT_NUMBER_RAW="$(normalize_scalar "$(read_repo_field project_number)")"

  if [[ -z "$REPO_OWNER" || -z "$REPO_NAME" ]]; then
    echo "repository.owner and repository.name must be set in $FACTORY_CONFIG_PATH" >&2
    exit 1
  fi

  if [[ -z "$PROJECT_OWNER" ]]; then
    PROJECT_OWNER="$REPO_OWNER"
  fi

  if [[ -z "$PROJECT_NUMBER_RAW" || "$PROJECT_NUMBER_RAW" == "null" ]]; then
    echo "repository.project_number must be set in $FACTORY_CONFIG_PATH" >&2
    exit 1
  fi

  if ! [[ "$PROJECT_NUMBER_RAW" =~ ^[0-9]+$ ]]; then
    echo "repository.project_number must be numeric, got: $PROJECT_NUMBER_RAW" >&2
    exit 1
  fi

  PROJECT_NUMBER="$PROJECT_NUMBER_RAW"
  REPO="$REPO_OWNER/$REPO_NAME"
}

graphql() {
  gh api graphql "$@"
}

resolve_project_payload() {
  # Query org-owned and user-owned projects in SEPARATE calls: combining
  # organization(login:) and user(login:) in one query makes the non-matching
  # half throw "Could not resolve to a User/Organization", which gh treats as
  # fatal. Try organization first, fall back to user.
  local org_query user_query out
  org_query=$(cat <<'GRAPHQL'
fragment ProjectFields on ProjectV2 {
  id
  title
  fields(first:100) {
    nodes {
      ... on ProjectV2FieldCommon { id name }
      ... on ProjectV2SingleSelectField { options { id name } }
    }
  }
}
query($owner:String!, $number:Int!) {
  organization(login:$owner) { projectV2(number:$number) { ...ProjectFields } }
}
GRAPHQL
)
  user_query=$(cat <<'GRAPHQL'
fragment ProjectFields on ProjectV2 {
  id
  title
  fields(first:100) {
    nodes {
      ... on ProjectV2FieldCommon { id name }
      ... on ProjectV2SingleSelectField { options { id name } }
    }
  }
}
query($owner:String!, $number:Int!) {
  user(login:$owner) { projectV2(number:$number) { ...ProjectFields } }
}
GRAPHQL
)
  out="$(graphql -f query="$org_query" -f owner="$PROJECT_OWNER" -F number="$PROJECT_NUMBER" 2>/dev/null || true)"
  if printf '%s' "$out" | python -c 'import json,sys
try: d = json.load(sys.stdin)
except Exception: sys.exit(1)
sys.exit(0 if ((d.get("data") or {}).get("organization") or {}).get("projectV2") else 1)' 2>/dev/null; then
    printf '%s' "$out"
    return 0
  fi
  graphql -f query="$user_query" -f owner="$PROJECT_OWNER" -F number="$PROJECT_NUMBER"
}

project_payload() {
  if [[ -z "${PROJECT_PAYLOAD_CACHE:-}" ]]; then
    PROJECT_PAYLOAD_CACHE="$(resolve_project_payload)"
  fi
  printf '%s' "$PROJECT_PAYLOAD_CACHE"
}

project_id() {
  project_payload | python -c '
import json, sys
data = json.load(sys.stdin).get("data", {})
project = ((data.get("organization") or {}).get("projectV2")
           or (data.get("user") or {}).get("projectV2"))
print((project or {}).get("id", ""))
'
}

field_id_by_name() {
  local field_name="$1"
  project_payload | python -c '
import json, sys
payload = json.load(sys.stdin)
field_name = sys.argv[1]
data = payload.get("data", {})
project = ((data.get("organization") or {}).get("projectV2")
           or (data.get("user") or {}).get("projectV2")
           or {})
for field in project.get("fields", {}).get("nodes", []):
    if field.get("name") == field_name:
        print(field.get("id", ""))
        break
' "$field_name"
}

option_id_by_name() {
  local field_name="$1"
  local option_name="$2"
  project_payload | python -c '
import json, sys
payload = json.load(sys.stdin)
field_name = sys.argv[1]
option_name = sys.argv[2]
data = payload.get("data", {})
project = ((data.get("organization") or {}).get("projectV2")
           or (data.get("user") or {}).get("projectV2")
           or {})
for field in project.get("fields", {}).get("nodes", []):
    if field.get("name") != field_name:
        continue
    for option in field.get("options", []) or []:
        if option.get("name") == option_name:
            print(option.get("id", ""))
            raise SystemExit(0)
print("")
' "$field_name" "$option_name"
}

resolve_issue() {
  local issue_ref="$1"
  local owner="$REPO_OWNER"
  local repo="$REPO_NAME"
  local number=""

  if [[ "$issue_ref" =~ ^https://github\.com/([^/]+)/([^/]+)/issues/([0-9]+)$ ]]; then
    owner="${BASH_REMATCH[1]}"
    repo="${BASH_REMATCH[2]}"
    number="${BASH_REMATCH[3]}"
  elif [[ "$issue_ref" =~ ^([^/]+)/([^#]+)#([0-9]+)$ ]]; then
    owner="${BASH_REMATCH[1]}"
    repo="${BASH_REMATCH[2]}"
    number="${BASH_REMATCH[3]}"
  elif [[ "$issue_ref" =~ ^#?([0-9]+)$ ]]; then
    number="${BASH_REMATCH[1]}"
  else
    echo "Invalid issue reference: $issue_ref" >&2
    exit 1
  fi

  ISSUE_OWNER="$owner"
  ISSUE_REPO="$repo"
  ISSUE_NUMBER="$number"
  ISSUE_REF="$ISSUE_OWNER/$ISSUE_REPO#$ISSUE_NUMBER"
  ISSUE_NODE_ID="$(gh api "repos/$ISSUE_OWNER/$ISSUE_REPO/issues/$ISSUE_NUMBER" --jq '.node_id')"
}

ensure_item() {
  # addProjectV2ItemById is idempotent: adding an issue already on the board
  # returns the existing item id. (ProjectV2 `items` has no server-side
  # contentId filter, so the previous lookup-first approach was invalid.)
  local issue_ref="$1"
  resolve_issue "$issue_ref"

  local mutation
  mutation=$(cat <<'GRAPHQL'
mutation($projectId:ID!, $contentId:ID!) {
  addProjectV2ItemById(input:{projectId:$projectId, contentId:$contentId}) {
    item { id }
  }
}
GRAPHQL
)

  ITEM_ID="$(
    graphql -f query="$mutation" -f projectId="$PROJECT_ID" -f contentId="$ISSUE_NODE_ID" | python -c '
import json, sys
payload = json.load(sys.stdin)
print((((payload.get("data") or {}).get("addProjectV2ItemById") or {}).get("item") or {}).get("id", ""))
'
  )"
  if [[ -z "$ITEM_ID" ]]; then
    echo "Failed to add $ISSUE_REF to project" >&2
    exit 1
  fi

  echo "Ensured on board: $ISSUE_REF"
}

set_single_select_field() {
  local issue_ref="$1"
  local field_name="$2"
  local option_name="$3"

  local fid oid
  fid="$(field_id_by_name "$field_name")"
  if [[ -z "$fid" ]]; then
    echo "Unknown project field: $field_name" >&2
    exit 1
  fi

  oid="$(option_id_by_name "$field_name" "$option_name")"
  if [[ -z "$oid" ]]; then
    echo "Unknown option '$option_name' for field '$field_name'" >&2
    exit 1
  fi

  ensure_item "$issue_ref"

  local mutation
  mutation=$(cat <<'GRAPHQL'
mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $optionId:String!) {
  updateProjectV2ItemFieldValue(
    input:{
      projectId:$projectId,
      itemId:$itemId,
      fieldId:$fieldId,
      value:{singleSelectOptionId:$optionId}
    }
  ) {
    projectV2Item {
      id
    }
  }
}
GRAPHQL
)

  graphql -f query="$mutation" -f projectId="$PROJECT_ID" -f itemId="$ITEM_ID" -f fieldId="$fid" -f optionId="$oid" >/dev/null
  echo "Set '$field_name'='$option_name' for $ISSUE_REF"
}

sync_all() {
  local numbers
  numbers="$(
    gh api "repos/$REPO_OWNER/$REPO_NAME/issues?state=open&per_page=100" --paginate \
      --jq '.[] | select(.pull_request | not) | .number'
  )"
  if [[ -z "$numbers" ]]; then
    echo "No open issues to sync for $REPO"
    return 0
  fi

  while IFS= read -r number; do
    [[ -z "$number" ]] && continue
    ensure_item "$number"
  done <<< "$numbers"
}

list_fields() {
  project_payload | python -c '
import json, sys
payload = json.load(sys.stdin)
data = payload.get("data", {})
project = ((data.get("organization") or {}).get("projectV2")
           or (data.get("user") or {}).get("projectV2")
           or {})
title = project.get("title", "unknown")
print(f"Project: {title}")
for field in project.get("fields", {}).get("nodes", []):
    name = field.get("name", "")
    options = [o.get("name", "") for o in (field.get("options") or []) if o.get("name")]
    if options:
        joined = ", ".join(options)
        print(f"- {name}: {joined}")
    else:
        print(f"- {name}")
'
}

link_parent() {
  # Create a NATIVE sub-issue relationship (epic -> story), not a "Part of #N"
  # text mention. Idempotent: re-linking an existing child is a no-op.
  local child_ref="$1" parent_ref="$2"
  resolve_issue "$child_ref"
  local child_node="$ISSUE_NODE_ID" child_disp="$ISSUE_REF"
  resolve_issue "$parent_ref"
  local parent_node="$ISSUE_NODE_ID" parent_disp="$ISSUE_REF"

  local mutation
  mutation=$(cat <<'GRAPHQL'
mutation($parent:ID!, $child:ID!) {
  addSubIssue(input:{issueId:$parent, subIssueId:$child}) { subIssue { number } }
}
GRAPHQL
)
  if graphql -H 'GraphQL-Features: sub_issues' -f query="$mutation" \
       -f parent="$parent_node" -f child="$child_node" >/dev/null 2>&1; then
    echo "Linked $child_disp as sub-issue of $parent_disp"
  else
    echo "Could not link $child_disp under $parent_disp (already linked, or not permitted)"
  fi
}

usage() {
  cat <<'USAGE'
Usage:
  scripts/project-sync.sh add <issue>
  scripts/project-sync.sh status <issue> <Status>
  scripts/project-sync.sh field <issue> <Field> <Option>
  scripts/project-sync.sh parent <child-issue> <epic-issue>
  scripts/project-sync.sh sync-all
  scripts/project-sync.sh fields
USAGE
}

main() {
  require_command gh
  require_command python
  ensure_config

  PROJECT_ID="$(project_id)"
  if [[ -z "$PROJECT_ID" ]]; then
    echo "Unable to resolve project #$PROJECT_NUMBER for owner '$PROJECT_OWNER'" >&2
    exit 1
  fi

  local cmd="${1:-}"
  shift || true

  case "$cmd" in
    add)
      [[ $# -eq 1 ]] || { usage; exit 1; }
      ensure_item "$1"
      ;;
    status)
      [[ $# -eq 2 ]] || { usage; exit 1; }
      set_single_select_field "$1" "Status" "$2"
      ;;
    field)
      [[ $# -eq 3 ]] || { usage; exit 1; }
      set_single_select_field "$1" "$2" "$3"
      ;;
    parent)
      [[ $# -eq 2 ]] || { usage; exit 1; }
      link_parent "$1" "$2"
      ;;
    sync-all)
      [[ $# -eq 0 ]] || { usage; exit 1; }
      sync_all
      ;;
    fields)
      [[ $# -eq 0 ]] || { usage; exit 1; }
      list_fields
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
