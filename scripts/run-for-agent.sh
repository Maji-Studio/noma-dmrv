#!/usr/bin/env bash
# Run a prepared main-checkout command with live output and a persistent log.
# Before handing over the command, remove the old log and start a background wait:
#   until grep -q '^exit=' <main>/.scratchpad/runs/<name>.log; do sleep 1; done
# Then hand the human one line: <checkout>/scripts/run-for-agent.sh <name> [args...]
# RUN_FOR_AGENT_ROOT overrides discovery for isolated tests only.
set -euo pipefail

EXIT_USAGE=2
EXIT_MISSING=127
NAME_PATTERN='^[A-Za-z0-9][A-Za-z0-9._-]*$'
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  printf 'Usage: scripts/run-for-agent.sh <name> [args...]\n'
}

if [ "$#" -eq 0 ]; then usage >&2; exit "$EXIT_USAGE"; fi
case "$1" in --help|-h) usage; exit 0 ;; esac
if [[ ! "$1" =~ $NAME_PATTERN ]]; then
  printf 'run-for-agent: invalid prepared script name: %s\n' "$1" >&2
  usage >&2
  exit "$EXIT_USAGE"
fi
NAME="$1"
shift

if [ -n "${RUN_FOR_AGENT_ROOT:-}" ]; then
  MAIN_CHECKOUT="$(cd "$RUN_FOR_AGENT_ROOT" && pwd)"
else
  COMMON_DIR="$(git -C "$SCRIPT_DIR" rev-parse --path-format=absolute --git-common-dir)"
  MAIN_CHECKOUT="$(cd "$COMMON_DIR/.." && pwd)"
fi
PREPARED="$MAIN_CHECKOUT/.scratchpad/$NAME.sh"
RUNS_DIR="$MAIN_CHECKOUT/.scratchpad/runs"
LOG="$RUNS_DIR/$NAME.log"
mkdir -p "$RUNS_DIR"
printf 'start=%s name=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$NAME" | tee "$LOG"

if [ ! -f "$PREPARED" ]; then
  printf 'run-for-agent: prepared script not found: %s\n' "$PREPARED" | tee -a "$LOG" >&2
  printf 'exit=%s\n' "$EXIT_MISSING" | tee -a "$LOG"
  exit "$EXIT_MISSING"
fi

run_prepared() {
  cd "$MAIN_CHECKOUT" || return
  if [ -x "$PREPARED" ]; then
    "$PREPARED" "$@"
  else
    local first_line=''
    local interpreter=(bash)
    IFS= read -r first_line < "$PREPARED" || true
    first_line="${first_line%$'\r'}"
    if [[ "$first_line" == '#!'* ]] && [ -n "${first_line#\#!}" ]; then
      read -r -a interpreter <<< "${first_line#\#!}"
      if [ "${#interpreter[@]}" -eq 0 ]; then interpreter=(bash); fi
    fi
    "${interpreter[@]}" "$PREPARED" "$@"
  fi
}

# Capture the command status before another command replaces PIPESTATUS.
set +e
run_prepared "$@" 2>&1 | tee -a "$LOG"
RESULT="${PIPESTATUS[0]}"
set -e
# A preceding newline keeps the sentinel separate even for output without one.
printf '\nexit=%s\n' "$RESULT" | tee -a "$LOG"
exit "$RESULT"
