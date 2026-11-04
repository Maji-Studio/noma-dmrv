#!/usr/bin/env bash
# PreToolUse hook (Bash): deny commands that kill processes by pattern.
# Other sessions share this machine; `pkill -f` and `killall` hit their dev servers.
# Kill by PID from `lsof -nP -iTCP:<port> -sTCP:LISTEN` instead.
# Fail closed: without jq the guard cannot read the command.
command -v jq >/dev/null || { echo "block-process-kill: jq is required" >&2; exit 2; }
command="$(jq -r '.tool_input.command // empty')" || exit 2
# Quotes stripped so "pkill" -f matches; a mention inside echo/rg text also matches (accepted).
bare="$(printf '%s' "$command" | tr -d "\"'")"
if printf '%s' "$bare" | grep -Eq '(^|[^[:alnum:]_-])(pkill[[:space:]]([^;&|]*[[:space:]])?-[[:alnum:]]*f[[:alnum:]]*([[:space:]]|$)|killall([[:space:]]|$))'; then
  jq -n '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "pkill -f and killall can stop other sessions processes. Find the PID you started (lsof -nP -iTCP:<port> -sTCP:LISTEN) and kill that PID."}}'
fi
exit 0
