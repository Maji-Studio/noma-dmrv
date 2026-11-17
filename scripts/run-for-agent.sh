#!/usr/bin/env bash
# Run a prepared, non-interactive main-checkout command with live output and a persistent log.
# Before handing over the command, remove the old status file and start a background wait:
#   until [ -s "<main checkout>/.scratchpad/runs/<name>.exit" ]; do sleep 1; done
# Then hand the human one line: "<main checkout>/scripts/run-for-agent.sh" <name> [args...]
# RUN_FOR_AGENT_ROOT overrides discovery for isolated tests only.
# A per-name lock refuses overlapping runs with exit 75.
set -euo pipefail

EXIT_SUCCESS=0
EXIT_USAGE=2
EXIT_LOCKED=75
EXIT_MISSING=127
EXIT_INTERRUPT=130
EXIT_TERMINATE=143
EXIT_HANGUP=129
INTERRUPT_GRACE_POLLS=30
INTERRUPT_KILL_POLLS=10
INTERRUPT_POLL_SECONDS=0.1
NAME_PATTERN='^[A-Za-z0-9][A-Za-z0-9._-]*$'
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  printf 'Usage: scripts/run-for-agent.sh <name> [args...]\n'
}

if [ "$#" -eq 0 ]; then usage >&2; exit "$EXIT_USAGE"; fi
case "$1" in --help|-h) usage; exit "$EXIT_SUCCESS" ;; esac
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
STATUS="$RUNS_DIR/$NAME.exit"
LOCK="$RUNS_DIR/$NAME.lock"
PIPELINE_PID=''
mkdir -p "$RUNS_DIR"

refuse_locked() {
  printf 'run-for-agent: prepared script already running or lock being acquired: %s\n' "$NAME" >&2
  exit "$EXIT_LOCKED"
}

while ! mkdir "$LOCK" 2>/dev/null; do
  LOCK_PID=''
  IFS= read -r LOCK_PID 2>/dev/null < "$LOCK/pid" || refuse_locked
  [[ "$LOCK_PID" =~ ^[1-9][0-9]*$ ]] || refuse_locked
  if kill -0 "$LOCK_PID" 2>/dev/null; then refuse_locked; fi
  # Only one contender may reclaim this dead owner's directory. Recheck after
  # claiming it in case the previous owner was replaced in the meantime.
  mkdir "$LOCK/reclaim" 2>/dev/null || refuse_locked
  CURRENT_LOCK_PID=''
  IFS= read -r CURRENT_LOCK_PID 2>/dev/null < "$LOCK/pid" || true
  if [ "$CURRENT_LOCK_PID" != "$LOCK_PID" ] || kill -0 "$LOCK_PID" 2>/dev/null; then
    rmdir "$LOCK/reclaim" 2>/dev/null || true
    refuse_locked
  fi
  rm -f "$LOCK/pid"
  rm -rf "$LOCK"
done

finish() {
  # Publishing is terminal: a second signal must not interrupt or duplicate it.
  trap '' INT TERM HUP PIPE
  trap - EXIT
  printf '\nexit=%s\n' "$1" >> "$LOG" || true
  local temporary_status="$STATUS.$$.tmp"
  printf '%s\n' "$1" > "$temporary_status"
  mv -f "$temporary_status" "$STATUS"
  rm -rf "$LOCK"
  printf '\nexit=%s\n' "$1" || true
  exit "$1"
}

interrupt() {
  trap '' INT TERM HUP PIPE
  if [ -n "$PIPELINE_PID" ]; then
    # The background job owns its process group, including the prepared script
    # and tee. Stop all of it before appending the final log line.
    kill -TERM -- "-$PIPELINE_PID" 2>/dev/null || true
    local poll=0
    while kill -0 -- "-$PIPELINE_PID" 2>/dev/null && [ "$poll" -lt "$INTERRUPT_GRACE_POLLS" ]; do
      sleep "$INTERRUPT_POLL_SECONDS" || true
      poll=$((poll + 1))
    done
    kill -KILL -- "-$PIPELINE_PID" 2>/dev/null || true
    wait "$PIPELINE_PID" 2>/dev/null || true
    # Allow killed descendants to be reaped even if the group leader exited first.
    poll=0
    while kill -0 -- "-$PIPELINE_PID" 2>/dev/null && [ "$poll" -lt "$INTERRUPT_KILL_POLLS" ]; do
      sleep "$INTERRUPT_POLL_SECONDS" || true
      poll=$((poll + 1))
    done
  fi
  finish "$1"
}
trap 'interrupt "$EXIT_INTERRUPT"' INT
trap 'interrupt "$EXIT_TERMINATE"' TERM
trap 'interrupt "$EXIT_HANGUP"' HUP
trap 'finish "$?"' EXIT
printf '%s\n' "$$" > "$LOCK/pid"
rm -f "$STATUS"

printf 'start=%s name=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$NAME" | tee "$LOG"

if [ ! -f "$PREPARED" ]; then
  printf 'run-for-agent: prepared script not found: %s\n' "$PREPARED" | tee -a "$LOG" >&2
  finish "$EXIT_MISSING"
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

# A background job lets wait handle signals immediately on Bash 3.2. Monitor
# mode gives this job its own group; disable it inside so the pipeline shares it.
# The job is outside the terminal's foreground group. Ignore terminal job-control
# signals so /dev/tty reads fail instead of stopping it; stdin stays /dev/null.
set -m
(
  set +m
  set +e
  trap '' TTIN TTOU
  run_prepared "$@" 2>&1 | tee -a "$LOG"
  exit "${PIPESTATUS[0]}"
) < /dev/null &
PIPELINE_PID=$!
set +m
RESULT="$EXIT_SUCCESS"
wait "$PIPELINE_PID" || RESULT=$?
# A preceding newline in finish separates status from unterminated output.
finish "$RESULT"
