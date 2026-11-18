#!/usr/bin/env bash
# Print normalized required-check JSON; callers decide how to handle failures.
GH_CHECKS_FAILURE_STATUS=1
GH_CHECKS_PENDING_STATUS=8

read_required_checks() {
  local pr="$1" repo="$2" response status=0
  response="$(gh pr checks "$pr" --repo "$repo" --required --json name,bucket,state 2>&1)" || status=$?
  case "$status" in
    0|"$GH_CHECKS_FAILURE_STATUS"|"$GH_CHECKS_PENDING_STATUS") ;;
    *) printf 'could not read required checks for #%s: %s\n' "$pr" "$response" >&2; return 1 ;;
  esac
  # gh prints a message instead of [] before checks exist.
  case "$response" in
    'no checks reported on '*|'no required checks reported on '*) response='[]' ;;
  esac
  if ! printf '%s\n' "$response" | jq -e '
    type == "array" and all(.[];
      (.bucket == "pass" or .bucket == "fail" or .bucket == "pending" or
       .bucket == "skipping" or .bucket == "cancel"))' >/dev/null 2>&1; then
    printf 'invalid required checks response for #%s: %s\n' "$pr" "$response" >&2
    return 1
  fi
  printf '%s\n' "$response"
}
