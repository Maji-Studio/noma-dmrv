#!/usr/bin/env bash
# PreToolUse hook (Bash): deny commands that kill processes by pattern.
# Threat model: stop careless pattern kills, not deliberate shell disguises.
# Other sessions share this machine; `pkill -f` and `killall` hit their dev servers.
# Kill by PID from `lsof -nP -iTCP:<port> -sTCP:LISTEN` instead.
# Only literal cat heredocs writing .md/.txt files outside outer heredocs and quotes
# are exempt. Shell comments end parsing of their line but stay checked.
# Other text, including grep/echo mentions, is denied.
# Telling a quoted pattern from an invocation needs a shell parser. A false deny
# costs one retry; a false allow can stop other sessions servers. Split the literal
# or search with a non-shell tool to avoid a false deny.
# Fail closed: without jq the guard cannot read the command.
command -v jq >/dev/null || { echo "block-process-kill: jq is required" >&2; exit 2; }
command="$(jq -sr 'if length != 1 or (.[0] | type) != "object"
  then error("expected one tool call object") else .[0].tool_input.command end |
  if . == null then empty
  elif type == "string" then . else error("command must be a string") end')" || exit 2
# Hide only terminated literal bodies of file-writing cat commands with no outer
# heredoc open. Other heredoc bodies stay checked, including nested literal cats.
command="$(printf '%s\n' "$command" | awk -v sq="'" '
  BEGIN {
    doc_extensions = "\\.(md|txt)$"
    current = 1
    word = "[A-Za-z0-9_.-]+"
    quoted = "[A-Za-z0-9_. -]+"
    literal = "(" sq quoted sq "|\"" word "\"|\\\\" word ")"
    heredoc = "<<-?[ \t]*" literal
    opening = "<<-?[ \t]*(" sq "[^" sq "]+" sq "|\"[^\"]+\"|[^ \t;&|<>]+)"
    forbidden = "()`|&;<>"
    target = "([^ \t\"" sq forbidden "]+|" sq "[^" sq forbidden "]*" sq "|\"[^\"" forbidden "]*\")"
    redirect = ">>?[ \t]*" target
    header = "(^|;|&&|[|][|])[ \t]*cat[ \t]*(" heredoc "[ \t]*" redirect "|" redirect "[ \t]*" heredoc ")[ \t]*$"
  }
  {
    lines[NR] = $0
    if (current <= pending) {
      end = $0
      if (strip_tabs[current]) sub(/^\t+/, "", end)
      if (end == delimiters[current]) {
        if (hide_body) for (i = body_start; i <= NR; i++) hidden[i] = 1
        current++
      }
      next
    }
    if (blocked) next
    line_quote = quote
    for (j = 1; j <= length($0); j++) {
      # Retain quote context for the header match after comment truncation.
      quote_before[j] = quote
      character = substr($0, j, 1)
      if (character == "\\" && quote != sq) { quote_before[j + 1] = quote; j++; continue }
      if (quote == "") {
        # Parse only the code prefix; lines[NR] keeps the comment visible.
        if (character == "#" && (j == 1 || substr($0, j - 1, 1) ~ /[[:space:];&|(]/)) {
          $0 = substr($0, 1, j - 1)
          break
        }
        if (character == sq || character == "\"") quote = character
      } else if (character == quote) quote = ""
    }
    operators = $0
    count = gsub(/<</, "", operators)
    is_header = match($0, header)
    header_start = RSTART
    # An outer quote makes even a literal-looking heredoc unsafe to hide.
    if ((count && line_quote != "") || (is_header && quote_before[header_start] != "")) blocked = 1
    if (blocked) next
    if (is_header) {
      header_text = substr($0, header_start)
      match(header_text, redirect)
      redirect_target = substr(header_text, RSTART, RLENGTH)
      sub(/^>>?[ \t]*/, "", redirect_target)
      gsub(/"/, "", redirect_target)
      gsub(sq, "", redirect_target)
    }
    hide_body = (lines[NR - 1] !~ /\\$/ && count == 1 && is_header && redirect_target ~ doc_extensions)
    suffix = $0
    current = 1
    pending = 0
    while (match(suffix, opening)) {
      token = substr(suffix, RSTART, RLENGTH)
      suffix = substr(suffix, RSTART + RLENGTH)
      pending++
      strip_tabs[pending] = (token ~ /^<<-/)
      sub(/^<<-?[ \t]*/, "", token)
      gsub(/["\\]/, "", token)
      gsub(sq, "", token)
      delimiters[pending] = token
    }
    # Unknown delimiter syntax stays visible and disables hiding for the rest.
    if (pending != count) blocked = 1
    body_start = NR + 1
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
