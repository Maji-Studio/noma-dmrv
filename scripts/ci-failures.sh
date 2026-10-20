#!/usr/bin/env bash
# Show failing PR checks and a capped excerpt of their failed Actions logs.
# Usage: scripts/ci-failures.sh <pr>
set -euo pipefail

REPO="Maji-Studio/noma-dmrv"
MAX_LINES_PER_RUN=120
CONTEXT_LINES=3
FALLBACK_LINES=30
GH_CHECKS_FAILURE_STATUS=1
GH_CHECKS_PENDING_STATUS=8
EXIT_FAILURE=1
EXIT_USAGE=2
PR_NUMBER_PATTERN='^[1-9][0-9]*$'
RUN_URL_PATTERN='/actions/runs/([0-9]+)([/?#]|$)'
ESC="$(printf '\033')"
TEMP_ROOT="${TMPDIR:-/tmp}"

usage() {
  cat <<'EOF'
Usage: scripts/ci-failures.sh <pr>

List failing or cancelled checks on the PR head. Fetch each linked Actions run
once and show capped Vitest/Playwright failures and error context. If no failure
pattern matches, show the last log lines with a note. Does not run tests.

Exit codes:
  0  Report printed, including when no checks fail
  1  Could not read checks or a failed-run log
  2  Invalid arguments or missing dependency
EOF
}

die() { printf 'ci-failures: %s\n' "$2" >&2; exit "$1"; }

clean_log() {
  # Actions prefixes are "<job><TAB><step><TAB><timestamp> <message>"; the step can be
  # "UNKNOWN STEP" and continuation lines may lack a timestamp. Strip ANSI colour codes first,
  # both real escapes and the caret form (^[[2m) that appears in some Actions logs.
  LC_ALL=C sed -e "s/${ESC}\\[[0-9;?]*[A-Za-z]//g" -e 's/\^\[\[[0-9;?]*[A-Za-z]//g' "$1" | awk '
    {
      line = $0
      first_tab = index(line, "\t")
      if (first_tab > 0) {
        rest = substr(line, first_tab + 1)
        second_tab = index(rest, "\t")
        if (second_tab > 0) line = substr(rest, second_tab + 1)
      }
      sub(/^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[^[:space:]]+[[:space:]]?/, "", line)
      sub(/^##\[error\][[:space:]]*/, "", line)
      sub(/\r$/, "", line)
      print line
    }
  '
}

failure_excerpt() {
  # Select context around each match, merge overlaps, and cap the whole run.
  # Return a sentinel status only when no pattern matched, for the tail fallback.
  awk -v context="$CONTEXT_LINES" -v cap="$MAX_LINES_PER_RUN" '
    {
      lines[NR] = $0
      if ($0 ~ /^[[:space:]]*FAIL[[:space:]]+/ ||
          $0 ~ /Failed Tests/ ||
          $0 ~ /^[[:space:]]*[0-9]+\)[[:space:]]+\[[^]]+\].*›/ ||
          $0 ~ /^[[:space:]]*(Error|AssertionError)([[:space:]]|:)/ ||
          $0 ~ /^[[:space:]]*[[:alnum:]_.]*(Error|AssertionError):/) {
        matched = 1
        start = NR - context
        if (start < 1) start = 1
        for (i = start; i <= NR + context; i++) selected[i] = 1
      }
    }
    END {
      if (!matched) exit 1
      for (i = 1; i <= NR; i++) {
        if (selected[i]) {
          if (printed >= cap) { truncated = 1; break }
          print lines[i]
          printed++
        }
      }
      if (truncated) print "[excerpt capped at " cap " log lines]"
    }
  ' "$1"
}

PR="${1:-}"
case "$PR" in --help|-h) usage; exit 0 ;; esac
[ "$#" = 1 ] && [[ "$PR" =~ $PR_NUMBER_PATTERN ]] || { usage >&2; exit "$EXIT_USAGE"; }
for dependency in gh jq awk tail mktemp; do
  command -v "$dependency" >/dev/null || die "$EXIT_USAGE" "missing dependency: $dependency"
done

CHECK_STATUS=0
CHECKS_JSON="$(gh pr checks "$PR" --repo "$REPO" --json name,bucket,state,link 2>&1)" || CHECK_STATUS=$?
case "$CHECK_STATUS" in
  0|"$GH_CHECKS_FAILURE_STATUS"|"$GH_CHECKS_PENDING_STATUS") ;;
  *) die "$EXIT_FAILURE" "could not read checks for #$PR: $CHECKS_JSON" ;;
esac
case "$CHECKS_JSON" in
  'no checks reported on '*) CHECKS_JSON='[]' ;;
esac
printf '%s\n' "$CHECKS_JSON" | jq -e 'type == "array"' >/dev/null ||
  die "$EXIT_FAILURE" "could not read checks for #$PR: $CHECKS_JSON"

FAILURES="$(printf '%s\n' "$CHECKS_JSON" | jq -r '
  .[] | select(.bucket == "fail" or .bucket == "cancel") | .name')"
if [ -z "$FAILURES" ]; then
  printf 'No failing checks for #%s.\n' "$PR"
  exit 0
fi
printf '%s\n' "$FAILURES"

RUN_IDS="$(printf '%s\n' "$CHECKS_JSON" | jq -r '
  .[] | select(.bucket == "fail" or .bucket == "cancel") | .link // empty' |
  while IFS= read -r link; do
    if [[ "$link" =~ $RUN_URL_PATTERN ]]; then printf '%s\n' "${BASH_REMATCH[1]}"; fi
  done | awk '!seen[$0]++')"
[ -n "$RUN_IDS" ] || exit 0

TEMP_DIR="$(mktemp -d "$TEMP_ROOT/ci-failures.XXXXXX")" || die "$EXIT_FAILURE" "could not create temporary log directory"
trap 'rm -rf "$TEMP_DIR"' EXIT
trap 'exit "$EXIT_FAILURE"' HUP INT TERM
REPORT_STATUS=0
while IFS= read -r run_id; do
  printf '\nRun %s:\n' "$run_id"
  if ! gh run view "$run_id" --repo "$REPO" --log-failed > "$TEMP_DIR/raw" 2> "$TEMP_DIR/error"; then
    printf 'ci-failures: could not read failed log for run %s\n' "$run_id" >&2
    REPORT_STATUS="$EXIT_FAILURE"
    continue
  fi
  clean_log "$TEMP_DIR/raw" > "$TEMP_DIR/clean"
  if ! failure_excerpt "$TEMP_DIR/clean"; then
    printf 'No matching test failure lines; last %s log lines:\n' "$FALLBACK_LINES"
    tail -n "$FALLBACK_LINES" "$TEMP_DIR/clean"
  fi
done <<< "$RUN_IDS"
exit "$REPORT_STATUS"
