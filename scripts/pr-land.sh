#!/usr/bin/env bash
# Merge staging only when a PR is DIRTY (conflicts), wait for CI, enqueue, and watch it land.
# A PR that is merely behind goes straight to the head and CI wait, then enqueue.
# Usage: scripts/pr-land.sh <pr> [--teardown <worktree-name>] [--dry-run]
set -euo pipefail

REPO="Maji-Studio/noma-dmrv"
OWNER="${REPO%/*}"
NAME="${REPO#*/}"
BASE_REF="origin/staging"
BASE_BRANCH="staging"
MERGE_STATE_POLL_INTERVAL_SECONDS=5
MERGE_STATE_TIMEOUT_SECONDS=60
HEAD_POLL_INTERVAL_SECONDS=10
HEAD_TIMEOUT_SECONDS=300
CHECK_POLL_INTERVAL_SECONDS=30
CHECK_TIMEOUT_SECONDS=3600
EMPTY_CHECK_GRACE_SECONDS=120
QUEUE_POLL_INTERVAL_SECONDS="${PR_LAND_POLL_INTERVAL_SECONDS:-30}"
QUEUE_TIMEOUT_SECONDS=3600
QUEUE_APPEARANCE_GRACE_POLLS=2
GH_CHECKS_FAILURE_STATUS=1
GH_CHECKS_PENDING_STATUS=8
EXIT_FAILURE=1
EXIT_USAGE=2
EXIT_HEAD_MOVED=3
EXIT_TIMEOUT=4
PR_NUMBER_PATTERN='^[1-9][0-9]*$'
POSITIVE_INTEGER_PATTERN='^[1-9][0-9]*$'
WORKTREE_NAME_PATTERN='^[a-z0-9][a-z0-9-]{0,30}$'
QUEUE_QUERY='query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){state isInMergeQueue mergeCommit{oid} timelineItems(itemTypes:[REMOVED_FROM_MERGE_QUEUE_EVENT],last:1){nodes{... on RemovedFromMergeQueueEvent{reason createdAt}}}}}}'
ENQUEUE_MUTATION='mutation($id:ID!,$sha:GitObjectID!){enqueuePullRequest(input:{pullRequestId:$id,expectedHeadOid:$sha}){mergeQueueEntry{state position}}}'
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIN_CHECKOUT="$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd)"

usage() {
  cat <<'EOF'
Usage: scripts/pr-land.sh <pr> [--teardown <worktree-name>] [--dry-run]

Merge origin/staging into the checked-out PR branch only when the PR is DIRTY
(conflicts), then push. A PR that is merely behind goes straight to the exact
head and CI wait, then enqueue. Watch for MERGED. Already queued PRs go
straight to watching, without merging or pushing. Never runs tests or deletes
branches itself. Open dependent PRs produce a warning to retarget them to staging.

  --teardown <name>  Run scripts/worktree.sh teardown <name> only after MERGED.
  --dry-run          Read current state and print proposed actions, then exit 0.
                     Does not fetch, merge, push, enqueue, watch, or tear down.
                     Uses GitHub's merge state and the current local SHA;
                     a proposed merge would change that SHA and require new CI.
  --help            Show this help.

PR_LAND_POLL_INTERVAL_SECONDS overrides the queue polling interval (default 30).
The queue watch and CI wait each time out after 60 minutes.

Exit codes:
  0  MERGED, or a completed dry-run/help request
  1  Closed/merged input, failed CI, conflict, queue removal, or command failure
  2  Invalid arguments, configuration, or missing dependency
  3  Head changed while waiting or preparing to enqueue
  4  Merge state, head sync, checks, missing-check grace, or queue watch timed out
Teardown failures are reported as exit 1, after printing the merge commit.
EOF
}

die() { printf 'pr-land: %s\n' "$2" >&2; exit "$1"; }
info() { printf 'pr-land: %s\n' "$*"; }

read_queue() {
  local response
  # gh api has no --repo flag. Scope GraphQL explicitly from REPO instead.
  response="$(GH_REPO="$REPO" gh api graphql -f query="$QUEUE_QUERY" \
    -f owner="$OWNER" -f name="$NAME" -F number="$PR")" ||
    die "$EXIT_FAILURE" "could not read #$PR queue state"
  QUEUE_JSON="$(printf '%s\n' "$response" | jq -ce '
    if (.errors | length) > 0 then error("GraphQL errors")
    else .data.repository.pullRequest |
      select((.state == "OPEN" or .state == "CLOSED" or .state == "MERGED") and
        (.isInMergeQueue == true or .isInMergeQueue == false)) end')" ||
    die "$EXIT_FAILURE" "invalid queue response for #$PR"
}

read_pr() {
  PR_JSON="$(gh pr view "$PR" --repo "$REPO" \
    --json id,state,headRefName,headRefOid,mergeStateStatus,baseRefName,isCrossRepository)" ||
    die "$EXIT_FAILURE" "could not read #$PR"
}

read_checks() {
  local status=0
  CHECKS_JSON="$(gh pr checks "$PR" --repo "$REPO" --required --json name,bucket,state 2>&1)" || status=$?
  case "$status" in
    0|"$GH_CHECKS_FAILURE_STATUS"|"$GH_CHECKS_PENDING_STATUS") ;;
    *) die "$EXIT_FAILURE" "could not read checks for #$PR: $CHECKS_JSON" ;;
  esac
  # gh prints a message instead of [] before checks exist (with --required: "no required checks ...").
  case "$CHECKS_JSON" in
    'no checks reported on '*|'no required checks reported on '*) CHECKS_JSON='[]' ;;
  esac
  printf '%s\n' "$CHECKS_JSON" | jq -e '
    type == "array" and all(.[];
      (.bucket == "pass" or .bucket == "fail" or .bucket == "pending" or
       .bucket == "skipping" or .bucket == "cancel"))' >/dev/null ||
    die "$EXIT_FAILURE" "could not read checks for #$PR: $CHECKS_JSON"
}

checks_summary() {
  printf '%s\n' "$CHECKS_JSON" | jq -r '
    if length == 0 then "no checks (pending)"
    else group_by(.bucket) | map("\(.[0].bucket)=\(length)") | join(" ") end'
}

print_failures() {
  printf '%s\n' "$CHECKS_JSON" | jq -r '
    .[] | select(.bucket == "fail" or .bucket == "cancel") | "  \(.name) (\(.bucket))"'
}

refuse_closed() {
  local state
  state="$(printf '%s\n' "$QUEUE_JSON" | jq -r '.state')"
  [ "$state" = OPEN ] || die "$EXIT_FAILURE" "#$PR state is $state; refusing to land it"
}

pause_before_deadline() {
  local deadline="$1" interval="$2" remaining
  remaining=$((deadline - SECONDS))
  [ "$remaining" -gt 0 ] || return 0
  if [ "$remaining" -lt "$interval" ]; then interval="$remaining"; fi
  sleep "$interval"
}

wait_for_merge_state() {
  local deadline merge_state
  deadline=$((SECONDS + MERGE_STATE_TIMEOUT_SECONDS))
  while true; do
    read_pr
    merge_state="$(printf '%s\n' "$PR_JSON" | jq -r '.mergeStateStatus')"
    [ "$merge_state" = UNKNOWN ] || return 0
    [ "$SECONDS" -lt "$deadline" ] ||
      die "$EXIT_TIMEOUT" "#$PR merge state remained UNKNOWN after ${MERGE_STATE_TIMEOUT_SECONDS}s; stopping"
    info "#$PR merge state UNKNOWN; waiting"
    pause_before_deadline "$deadline" "$MERGE_STATE_POLL_INTERVAL_SECONDS"
  done
}

watch_queue() {
  local grace_polls="$1" deadline state queued reason created_at oid
  deadline=$((SECONDS + QUEUE_TIMEOUT_SECONDS))
  while true; do
    read_queue
    state="$(printf '%s\n' "$QUEUE_JSON" | jq -r '.state')"
    queued="$(printf '%s\n' "$QUEUE_JSON" | jq -r '.isInMergeQueue')"
    if [ "$state" = MERGED ]; then
      oid="$(printf '%s\n' "$QUEUE_JSON" | jq -r '.mergeCommit.oid // empty')"
      [ -n "$oid" ] || die "$EXIT_FAILURE" "#$PR is MERGED but its merge commit oid is unavailable; teardown skipped"
      info "#$PR MERGED: $oid"
      if [ -n "$TEARDOWN" ]; then
        # worktree.sh refuses to run from inside its target, so run it from the main checkout.
        (cd "$MAIN_CHECKOUT" && "$SCRIPT_DIR/worktree.sh" teardown "$TEARDOWN") ||
          die "$EXIT_FAILURE" "#$PR merged at $oid, but teardown of $TEARDOWN failed"
      fi
      return 0
    fi
    if [ "$queued" = true ]; then
      grace_polls=0
    elif [ "$grace_polls" -gt 0 ]; then
      grace_polls=$((grace_polls - 1))
    else
      reason="$(printf '%s\n' "$QUEUE_JSON" | jq -r '.timelineItems.nodes[0].reason // "unknown"')"
      created_at="$(printf '%s\n' "$QUEUE_JSON" | jq -r '.timelineItems.nodes[0].createdAt // "unknown time"')"
      info "#$PR left the queue unmerged: $reason ($created_at)"
      case "$reason" in
        failed_checks)
          info "Run scripts/ci-failures.sh $PR for head CI. For merge-group CI, find the merge_group run on gh-readonly-queue/staging/pr-$PR-<base sha> and inspect it with gh run view <run-id> --repo $REPO --log-failed."
          info "Compare staging's own CI before re-enqueueing."
          ;;
        merge_conflict)
          info "A PR may have merged minutes earlier. Merge origin/staging into the PR worktree, resolve conflicts, then re-run scripts/pr-land.sh $PR."
          ;;
        merged) info "Removal reason is merged, but state is $state. Confirm MERGED before any teardown." ;;
        *) info "Inspect the removal event and CI before re-enqueueing." ;;
      esac
      exit "$EXIT_FAILURE"
    fi
    [ "$SECONDS" -lt "$deadline" ] ||
      die "$EXIT_TIMEOUT" "#$PR queue watch timed out after ${QUEUE_TIMEOUT_SECONDS}s; teardown skipped"
    info "#$PR state=$state queue=$queued; waiting"
    pause_before_deadline "$deadline" "$QUEUE_POLL_INTERVAL_SECONDS"
  done
}

watch_if_queued() {
  read_queue
  refuse_closed
  if [ "$(printf '%s\n' "$QUEUE_JSON" | jq -r '.isInMergeQueue')" = true ]; then
    info "#$PR is already queued; watching without pushing or enqueueing"
    watch_queue 0
    exit 0
  fi
}

find_worktree() {
  local record candidate=""
  WORKTREE=""
  # NUL-delimited records preserve worktree paths containing spaces or tabs.
  while IFS= read -r -d '' record; do
    case "$record" in
      worktree\ *) candidate="${record#worktree }" ;;
      "branch refs/heads/$BRANCH") WORKTREE="$candidate"; break ;;
    esac
  done < <(git worktree list --porcelain -z)
  [ -n "$WORKTREE" ] || die "$EXIT_FAILURE" "no worktree has branch $BRANCH checked out"
}

ensure_local_head() {
  local branch sha
  branch="$(git -C "$WORKTREE" symbolic-ref --quiet --short HEAD)" ||
    die "$EXIT_HEAD_MOVED" "HEAD in $WORKTREE is detached; stopping"
  [ "$branch" = "$BRANCH" ] || die "$EXIT_HEAD_MOVED" "branch in $WORKTREE changed to $branch; stopping"
  sha="$(git -C "$WORKTREE" rev-parse HEAD)"
  [ "$sha" = "$LOCAL_HEAD" ] || die "$EXIT_HEAD_MOVED" "local HEAD in $WORKTREE moved to $sha; stopping"
}

ensure_pr_head() {
  local head state
  read_pr
  head="$(printf '%s\n' "$PR_JSON" | jq -r '.headRefOid')"
  state="$(printf '%s\n' "$PR_JSON" | jq -r '.state')"
  [ "$state" = OPEN ] || die "$EXIT_FAILURE" "#$PR state is $state; stopping"
  [ "$head" = "$LOCAL_HEAD" ] ||
    die "$EXIT_HEAD_MOVED" "#$PR head moved to $head; expected $LOCAL_HEAD; stopping"
}

prepare_branch() {
  local merge_state conflicts
  git fetch origin || die "$EXIT_FAILURE" "could not fetch origin"
  ensure_local_head
  wait_for_merge_state
  merge_state="$(printf '%s\n' "$PR_JSON" | jq -r '.mergeStateStatus')"
  if [ "$merge_state" != DIRTY ]; then
    info "merge state $merge_state; not merging staging"
    return 0
  fi
  info "merge state DIRTY; merging staging"
  watch_if_queued
  [ -z "$(git -C "$WORKTREE" status --porcelain)" ] ||
    die "$EXIT_FAILURE" "$WORKTREE has uncommitted changes; commit or stash them before merging"
  ensure_local_head
  info "merging $BASE_REF into $WORKTREE"
  if ! git -C "$WORKTREE" merge "$BASE_REF" --no-edit; then
    conflicts="$(git -C "$WORKTREE" diff --name-only --diff-filter=U)"
    if [ -n "$conflicts" ]; then
      printf 'pr-land: conflicts in %s:\n%s\n' "$WORKTREE" "$conflicts" >&2
      git -C "$WORKTREE" merge --abort ||
        die "$EXIT_FAILURE" "merge abort failed in $WORKTREE; resolve it there before continuing"
      die "$EXIT_FAILURE" "merge aborted in $WORKTREE; resolve the staging conflicts there before retrying"
    fi
    die "$EXIT_FAILURE" "merge failed in $WORKTREE; inspect it before retrying"
  fi
  LOCAL_HEAD="$(git -C "$WORKTREE" rev-parse HEAD)"
  # The branch is push-protected once queued. Check again after the local merge.
  watch_if_queued
  ensure_local_head
  if ! git -C "$WORKTREE" push origin "HEAD:$BRANCH"; then
    # A concurrent enqueue makes the branch push-protected; if so, just watch.
    watch_if_queued
    die "$EXIT_FAILURE" "push failed from $WORKTREE; inspect queue state before retrying"
  fi
}

wait_for_head() {
  local deadline head state
  deadline=$((SECONDS + HEAD_TIMEOUT_SECONDS))
  while true; do
    ensure_local_head
    read_pr
    state="$(printf '%s\n' "$PR_JSON" | jq -r '.state')"
    [ "$state" = OPEN ] || die "$EXIT_FAILURE" "#$PR state is $state; stopping"
    head="$(printf '%s\n' "$PR_JSON" | jq -r '.headRefOid')"
    [ "$head" != "$LOCAL_HEAD" ] || return 0
    [ "$SECONDS" -lt "$deadline" ] ||
      die "$EXIT_TIMEOUT" "#$PR GitHub head $head never matched local HEAD $LOCAL_HEAD in $WORKTREE after ${HEAD_TIMEOUT_SECONDS}s. Check for unpushed commits; nothing was enqueued."
    info "#$PR waiting for GitHub head to match $LOCAL_HEAD (currently $head)"
    pause_before_deadline "$deadline" "$HEAD_POLL_INTERVAL_SECONDS"
  done
}

wait_for_checks() {
  local deadline empty_since=-1 merge_state summary
  deadline=$((SECONDS + CHECK_TIMEOUT_SECONDS))
  while true; do
    ensure_local_head
    ensure_pr_head
    read_checks
    ensure_pr_head
    merge_state="$(printf '%s\n' "$PR_JSON" | jq -r '.mergeStateStatus')"
    summary="$(checks_summary)"
    info "#$PR checks: $summary; merge state: $merge_state"
    if printf '%s\n' "$CHECKS_JSON" | jq -e 'any(.[]; .bucket == "fail" or .bucket == "cancel")' >/dev/null; then
      print_failures
      die "$EXIT_FAILURE" "CI failed. Run scripts/ci-failures.sh $PR"
    fi
    [ "$merge_state" != DIRTY ] || die "$EXIT_FAILURE" "#$PR conflicts with staging (DIRTY); resolve in $WORKTREE"
    if [ "$(printf '%s\n' "$CHECKS_JSON" | jq 'length')" = 0 ]; then
      if [ "$empty_since" -lt 0 ]; then empty_since="$SECONDS"; fi
      [ "$((SECONDS - empty_since))" -lt "$EMPTY_CHECK_GRACE_SECONDS" ] ||
        die "$EXIT_TIMEOUT" "#$PR has no checks after ${EMPTY_CHECK_GRACE_SECONDS}s; nothing was enqueued"
    else
      empty_since=-1
      if ! printf '%s\n' "$CHECKS_JSON" | jq -e 'any(.[]; .bucket == "pending")' >/dev/null; then
        return 0
      fi
    fi
    [ "$SECONDS" -lt "$deadline" ] || die "$EXIT_TIMEOUT" "#$PR checks timed out after ${CHECK_TIMEOUT_SECONDS}s"
    pause_before_deadline "$deadline" "$CHECK_POLL_INTERVAL_SECONDS"
  done
}

dry_run() {
  local queued merge_state remote_head
  read_checks
  read_pr
  read_queue
  refuse_closed
  queued="$(printf '%s\n' "$QUEUE_JSON" | jq -r '.isInMergeQueue')"
  merge_state="$(printf '%s\n' "$PR_JSON" | jq -r '.mergeStateStatus')"
  remote_head="$(printf '%s\n' "$PR_JSON" | jq -r '.headRefOid')"
  info "#$PR checks: $(checks_summary); merge state: $merge_state; queue state: $queued"
  print_failures
  if [ "$queued" = true ]; then
    info "#$PR already queued; would watch for MERGED without pushing or enqueueing"
  else
    wait_for_merge_state
    merge_state="$(printf '%s\n' "$PR_JSON" | jq -r '.mergeStateStatus')"
    remote_head="$(printf '%s\n' "$PR_JSON" | jq -r '.headRefOid')"
    find_worktree
    LOCAL_HEAD="$(git -C "$WORKTREE" rev-parse HEAD)"
    info "would fetch origin before a live run"
    if [ "$merge_state" = DIRTY ]; then
      info "would merge origin/staging into $WORKTREE and push"
      info "the proposed merge would change HEAD and require checking the new SHA"
    else
      info "merge state $merge_state: would not merge origin/staging"
    fi
    info "local head: $LOCAL_HEAD; GitHub head: $remote_head"
    if [ "$remote_head" != "$LOCAL_HEAD" ]; then
      info "a live run would wait for GitHub to match the local head; check for unpushed commits"
    fi
    info "would enqueue $PR_ID at $LOCAL_HEAD"
    info "preview only; head sync, successful checks, and conflict checks must pass before enqueueing"
  fi
  if [ -n "$TEARDOWN" ]; then info "would tear down $TEARDOWN only after confirming MERGED"; fi
}

PR="${1:-}"
TEARDOWN=""
DRY_RUN=0
case "$PR" in --help|-h) usage; exit 0 ;; esac
[[ "$PR" =~ $PR_NUMBER_PATTERN ]] || { usage >&2; exit "$EXIT_USAGE"; }
shift
while [ "$#" -gt 0 ]; do
  case "$1" in
    --teardown)
      [ "$#" -ge 2 ] || die "$EXIT_USAGE" "--teardown requires a worktree name"
      [[ "$2" =~ $WORKTREE_NAME_PATTERN ]] || die "$EXIT_USAGE" "invalid worktree name: $2"
      [ -z "$TEARDOWN" ] || die "$EXIT_USAGE" "--teardown may only be supplied once"
      TEARDOWN="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) usage >&2; die "$EXIT_USAGE" "unknown argument: $1" ;;
  esac
done
[[ "$QUEUE_POLL_INTERVAL_SECONDS" =~ $POSITIVE_INTEGER_PATTERN ]] ||
  die "$EXIT_USAGE" "PR_LAND_POLL_INTERVAL_SECONDS must be a positive integer"
for dependency in gh jq git; do
  command -v "$dependency" >/dev/null || die "$EXIT_USAGE" "missing dependency: $dependency"
done

read_queue
refuse_closed
if [ "$DRY_RUN" = 0 ] && [ "$(printf '%s\n' "$QUEUE_JSON" | jq -r '.isInMergeQueue')" = true ]; then
  info "#$PR is already queued; watching without pushing or enqueueing"
  watch_queue 0
  exit 0
fi
read_pr
BRANCH="$(printf '%s\n' "$PR_JSON" | jq -r '.headRefName')"
PR_ID="$(printf '%s\n' "$PR_JSON" | jq -r '.id')"
[ "$(printf '%s\n' "$PR_JSON" | jq -r '.isCrossRepository')" = false ] ||
  die "$EXIT_FAILURE" "#$PR comes from a fork; refusing to push to a local branch of the same name"
[ "$(printf '%s\n' "$PR_JSON" | jq -r '.baseRefName')" = "$BASE_BRANCH" ] ||
  die "$EXIT_FAILURE" "#$PR targets $(printf '%s\n' "$PR_JSON" | jq -r '.baseRefName'), not $BASE_BRANCH; refusing to merge staging into it"
DEPENDENTS="$(gh pr list --repo "$REPO" --state open --base "$BRANCH" --json number \
  --jq 'map("#\(.number)") | join(", ")')" || die "$EXIT_FAILURE" "could not check dependent PRs"
if [ -n "$DEPENDENTS" ]; then
  info "Warning: open PRs $DEPENDENTS target $BRANCH. Retarget them to staging before #$PR merges."
fi
if [ "$DRY_RUN" = 1 ]; then dry_run; exit 0; fi

find_worktree
LOCAL_HEAD="$(git -C "$WORKTREE" rev-parse HEAD)"
prepare_branch
wait_for_head
wait_for_checks
watch_if_queued
ensure_local_head
ensure_pr_head
[ "$(printf '%s\n' "$PR_JSON" | jq -r '.mergeStateStatus')" != DIRTY ] ||
  die "$EXIT_FAILURE" "#$PR conflicts with staging (DIRTY); nothing was enqueued"
# expectedHeadOid makes a concurrent remote-head change fail atomically.
ENQUEUE_RESPONSE="$(GH_REPO="$REPO" gh api graphql -f query="$ENQUEUE_MUTATION" \
  -f id="$PR_ID" -f sha="$LOCAL_HEAD")" || die "$EXIT_FAILURE" "could not enqueue #$PR"
ENQUEUE_SUMMARY="$(printf '%s\n' "$ENQUEUE_RESPONSE" | jq -er '
  if (.errors | length) > 0 then error("GraphQL errors")
  else .data.enqueuePullRequest.mergeQueueEntry | select(. != null) |
    "state=\(.state) position=\(.position)" end')" || die "$EXIT_FAILURE" "enqueue returned no queue entry for #$PR"
info "#$PR enqueued at $LOCAL_HEAD: $ENQUEUE_SUMMARY"
watch_queue "$QUEUE_APPEARANCE_GRACE_POLLS"
