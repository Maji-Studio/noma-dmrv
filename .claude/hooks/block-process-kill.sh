#!/usr/bin/env bash
# PreToolUse hook (Bash): deny commands that kill processes by pattern.
# Other sessions share this machine; `pkill -f` and `killall` hit their dev servers.
# Kill by PID from `lsof -nP -iTCP:<port> -sTCP:LISTEN` instead.
command="$(jq -r '.tool_input.command // empty')"
if printf '%s' "$command" | grep -Eq '(^|[^[:alnum:]_-])(pkill[[:space:]]+(-[[:alnum:]]+[[:space:]]+)*-f|killall)([[:space:]]|$)'; then
  jq -n '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "pkill -f and killall can stop other sessions processes. Find the PID you started (lsof -nP -iTCP:<port> -sTCP:LISTEN) and kill that PID."}}'
fi
exit 0
