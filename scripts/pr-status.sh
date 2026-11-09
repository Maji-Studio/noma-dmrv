#!/usr/bin/env bash
# Read PR landing and local teardown status without changing anything.
set -euo pipefail

REPO="Maji-Studio/noma-dmrv"
OWNER="${REPO%/*}"
NAME="${REPO#*/}"
EXIT_FAILURE=1
EXIT_USAGE=2
GH_CHECKS_FAILURE_STATUS=1
GH_CHECKS_PENDING_STATUS=8
SHORT_SHA_LENGTH=7
PR_NUMBER_PATTERN='^[1-9][0-9]*$'
QUEUE_QUERY='query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){mergeQueueEntry{position state}}}}'

usage() {
  cat <<'EOF'
Usage: scripts/pr-status.sh <pr> [<pr>...]

Read state, head SHA, required-check buckets, merge state, queue position/state,
local worktree basename, and (when MERGED) merge SHA. Makes no writes.
Format: #<pr> <state> <head> checks=<bucket=count,...|none>
        merge-state=<state> queue=<position/state|no> worktree=<basename|none>
        [merge=<sha>] (all on one line)
  --help  Show this help.

Exit codes:
  0  Every PR was read, or help requested
  1  At least one PR could not be read; other PRs are still printed
  2  Invalid arguments or missing dependency
EOF
}

die() { printf 'pr-status: %s\n' "$2" >&2; exit "$1"; }
read_error() { printf '%s' "$*"; exit "$EXIT_FAILURE"; }

read_checks() {
  local status=0
  CHECKS_JSON="$(gh pr checks "$PR" --repo "$REPO" --required --json name,bucket,state 2>&1)" || status=$?
  case "$status" in
    0|"$GH_CHECKS_FAILURE_STATUS"|"$GH_CHECKS_PENDING_STATUS") ;;
    *) read_error 'could not read required checks' ;;
  esac
  # gh prints a message instead of [] before checks exist.
  case "$CHECKS_JSON" in
    'no checks reported on '*|'no required checks reported on '*) CHECKS_JSON='[]' ;;
  esac
  printf '%s\n' "$CHECKS_JSON" | jq -e '
    type == "array" and all(.[];
      (.bucket == "pass" or .bucket == "fail" or .bucket == "pending" or
       .bucket == "skipping" or .bucket == "cancel"))' >/dev/null ||
    read_error 'invalid required checks response'
}

checks_summary() {
  printf '%s\n' "$CHECKS_JSON" | jq -r '
    if length == 0 then "none"
    else group_by(.bucket) | map("\(.[0].bucket)=\(length)") | join(",") end'
}

read_worktree() {
  git worktree list --porcelain -z | {
    local field path='' found=none
    while IFS= read -r -d '' field; do
      case "$field" in
        'worktree '*) path="${field#worktree }" ;;
        "branch refs/heads/$BRANCH") found="${path##*/}" ;;
      esac
    done
    printf '%s' "$found"
  }
}

read_status() {
  local pr_json queue_json state head merge_state queue worktree merge=''
  pr_json="$(gh pr view "$PR" --repo "$REPO" \
    --json state,headRefName,headRefOid,mergeStateStatus,mergeCommit 2>/dev/null)" || read_error 'could not read PR'
  printf '%s\n' "$pr_json" | jq -e '
    (.state == "OPEN" or .state == "MERGED" or .state == "CLOSED") and
    (.headRefName | type == "string" and length > 0 and (test("[[:cntrl:]]") | not)) and
    (.headRefOid | test("^[0-9a-fA-F]+$")) and
    (.mergeStateStatus | test("^[A-Z_]+$")) and
    (if .state == "MERGED" then (.mergeCommit.oid | test("^[0-9a-fA-F]+$")) else true end)' >/dev/null 2>&1 ||
    read_error 'invalid PR response'
  # gh api has no --repo flag. Scope GraphQL explicitly from REPO instead.
  queue_json="$(GH_REPO="$REPO" gh api graphql -f query="$QUEUE_QUERY" \
    -f owner="$OWNER" -f name="$NAME" -F number="$PR" 2>/dev/null)" || read_error 'could not read queue'
  queue="$(printf '%s\n' "$queue_json" | jq -er '
    if (.errors | length) > 0 or (.data.repository.pullRequest | type) != "object"
    then error("invalid queue response")
    else .data.repository.pullRequest | if has("mergeQueueEntry") | not then error("missing queue entry")
    elif .mergeQueueEntry == null then "no"
    else .mergeQueueEntry | if (.position | type == "number" and . > 0 and floor == .) and
      (.state | test("^[A-Z_]+$")) then "\(.position)/\(.state)"
      else error("invalid queue entry") end end end' 2>/dev/null)" || read_error 'invalid queue response'
  read_checks
  BRANCH="$(printf '%s\n' "$pr_json" | jq -r '.headRefName')"
  worktree="$(read_worktree)" || read_error 'could not read local worktrees'
  # Keep each PR on one line even for unusual local directory names.
  case "$worktree" in *$'\n'*|*$'\r'*) read_error 'invalid worktree path' ;; esac
  state="$(printf '%s\n' "$pr_json" | jq -r '.state')"
  head="$(printf '%s\n' "$pr_json" | jq -r '.headRefOid')"
  merge_state="$(printf '%s\n' "$pr_json" | jq -r '.mergeStateStatus')"
  if [ "$state" = MERGED ]; then
    merge="$(printf '%s\n' "$pr_json" | jq -r '.mergeCommit.oid')"
    merge=" merge=${merge:0:SHORT_SHA_LENGTH}"
  fi
  printf '#%s %s %s checks=%s merge-state=%s queue=%s worktree=%s%s' \
    "$PR" "$state" "${head:0:SHORT_SHA_LENGTH}" "$(checks_summary)" "$merge_state" "$queue" "$worktree" "$merge"
}

if [ "$#" -eq 1 ] && [ "$1" = --help ]; then usage; exit 0; fi
[ "$#" -gt 0 ] || { usage >&2; exit "$EXIT_USAGE"; }
for PR in "$@"; do [[ "$PR" =~ $PR_NUMBER_PATTERN ]] || die "$EXIT_USAGE" "invalid PR number: $PR"; done
for dependency in gh jq git; do command -v "$dependency" >/dev/null || die "$EXIT_USAGE" "$dependency is required"; done
result=0
for PR in "$@"; do
  if line="$(read_status)"; then printf '%s\n' "$line"
  else printf '#%s ERROR %s\n' "$PR" "$line"; result="$EXIT_FAILURE"; fi
done
exit "$result"
