#!/usr/bin/env bash
# PreToolUse hook (Bash): deny commands that kill processes by pattern.
# Threat model: stop careless pattern kills, not deliberate shell disguises.
# Other sessions share this machine; `pkill -f` and `killall` hit their dev servers.
# Kill by PID from `lsof -nP -iTCP:<port> -sTCP:LISTEN` instead.
# Outside literal file-writing cat heredocs, even grep/echo mentions are denied.
# Telling a quoted pattern from an invocation needs a shell parser. A false deny
# costs one retry; a false allow can stop other sessions servers. Split the literal
# or search with a non-shell tool to avoid a false deny.
# Fail closed: without jq the guard cannot read the command.
command -v jq >/dev/null || { echo "block-process-kill: jq is required" >&2; exit 2; }
command="$(jq -sr 'if length != 1 or (.[0] | type) != "object"
  then error("expected one tool call object") else .[0].tool_input.command end |
  if . == null then empty
  elif type == "string" then . else error("command must be a string") end')" || exit 2
# Hide only terminated literal bodies of file-writing cat commands.
command="$(printf '%s\n' "$command" | awk -v sq="'" '
  BEGIN {
    word = "[A-Za-z0-9_.-]+"
    quoted = "[A-Za-z0-9_. -]+"
    literal = "(" sq quoted sq "|\"" word "\"|\\\\" word ")"
    heredoc = "<<-?[ \t]*" literal
    forbidden = "()`|&;<>"
    target = "([^ \t\"" sq forbidden "]+|" sq "[^" sq forbidden "]*" sq "|\"[^\"" forbidden "]*\")"
    redirect = ">>?[ \t]*" target
    header = "(^|;|&&|[|][|])[ \t]*cat[ \t]*(" heredoc "[ \t]*" redirect "|" redirect "[ \t]*" heredoc ")[ \t]*$"
  }
  {
    lines[NR] = $0
    if (active) {
      end = $0
      if (tabs) sub(/^\t+/, "", end)
      if (end == delimiter) {
        for (i = body_start; i <= NR; i++) hidden[i] = 1
        active = 0
      }
      next
    }
    operators = $0
    if (lines[NR - 1] !~ /\\$/ && gsub(/<</, "", operators) == 1 && match($0, header)) {
      suffix = substr($0, RSTART, RLENGTH)
      match(suffix, heredoc)
      token = substr(suffix, RSTART, RLENGTH)
      tabs = (token ~ /^<<-/)
      sub(/^<<-?[ \t]*/, "", token)
      if (substr(token, 1, 1) == "\\") delimiter = substr(token, 2)
      else delimiter = substr(token, 2, length(token) - 2)
      body_start = NR + 1
      active = 1
    }
  }
  END {
    for (i = 1; i <= NR; i++) if (!hidden[i]) print lines[i]
  }
')" || exit 2
# Quotes stripped so "pkill" -f matches; a mention inside echo/rg text also matches (accepted).
bare="$(printf '%s' "$command" | tr -d "\"'")"
if printf '%s' "$bare" | grep -Eq '(^|[^[:alnum:]_-])(pkill[[:space:]]([^;&|]*[[:space:]])?-[[:alnum:]]*f[[:alnum:]]*([[:space:]]|$)|killall([[:space:]]|$))'; then
  jq -n '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "pkill -f and killall can stop other sessions processes. Find the PID you started (lsof -nP -iTCP:<port> -sTCP:LISTEN) and kill that PID."}}'
fi
exit 0
