#!/usr/bin/env bash
# Isolated git worktrees for parallel sessions: one writer per worktree, each with its own
# databases and port, so no session clobbers the main checkout's dev DB or :3100.
#
#   scripts/worktree.sh new <name> <branch>   worktree at .claude/worktrees/<name>, cut from origin/staging
#   scripts/worktree.sh status                 managed worktrees, DBs, ports, owners, PR state, and strays
#   scripts/worktree.sh teardown <name> [--force]
#
# `new` claims the name and a port atomically (mkdir), copies .env.local and .env.test by name,
# creates noma_dmrv_wt_<name>_dev (dev server, Playwright) and noma_dmrv_wt_<name>_test (Vitest),
# installs, resets and migrates both, and records them in .claude/worktrees/.owners/<name>/owner.
# `teardown` removes only what that record lists as created, refuses from inside the worktree or
# while it has uncommitted changes, and needs --force for another session's worktree.
# See docs/testing.md#worktrees.
set -euo pipefail

PG_CONTAINER="noma-dmrv-postgres"
PG_USER="postgres"
BASE_REF="origin/staging"
PORT_FIRST=3101
PORT_LAST=3199
RESERVED_PORTS=" 3120 " # marketing site dev server
NAME_PATTERN='^[a-z0-9][a-z0-9-]{0,30}$'
# A test/e2e segment would put the dev DB inside Vitest's throwaway rule (tests/helpers/throwaway-database.ts).
RESERVED_NAME_SEGMENT='(^|-)(test|e2e|dev)(-|$)'
STOP_WAIT_TICKS=20
STOP_TICK_SECONDS=0.5

MAIN="$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd)"
WORKTREES="$MAIN/.claude/worktrees"
OWNERS="$WORKTREES/.owners"
PORT_CLAIMS="$OWNERS/.ports"
SESSION="${CLAUDE_CODE_SESSION_ID:-manual-${USER:-unknown}}"

die() { echo "worktree: $*" >&2; exit 1; }
info() { echo "worktree: $*"; }

psql_admin() { docker exec "$PG_CONTAINER" psql -U "$PG_USER" -v ON_ERROR_STOP=1 -tAc "$1"; }
db_exists() { [ "$(psql_admin "SELECT 1 FROM pg_database WHERE datname = '$1'")" = "1" ]; }
# The host port the container publishes 5432 on; every URL must use it, so `CREATE` (through
# docker exec) and db:reset (through the URL) hit the same server.
pg_host_port() { docker port "$PG_CONTAINER" 5432/tcp | head -1 | sed 's/.*://'; }
port_listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# Replace or append KEY=value in an env file.
set_env() {
  local file="$1" key="$2" value="$3" tmp
  tmp="$(mktemp)"
  grep -v "^${key}=" "$file" > "$tmp" || true
  printf '%s="%s"\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$file"
}

# The main checkout's DATABASE_URL with the database name swapped. Aborts unless the result
# is local and ends in the requested name (a silent no-op rewrite once hit the dev DB).
db_url_for() {
  local db="$1" base url
  base="$(grep -E '^DATABASE_URL=' "$MAIN/.env.local" | head -1 | cut -d= -f2- | tr -d '"'"'")"
  [ -n "$base" ] || die "no DATABASE_URL in $MAIN/.env.local"
  base="${base%%\?*}"
  url="${base%/*}/${db}"
  case "$url" in
    *://*@localhost:"$(pg_host_port)"/"$db" | *://*@127.0.0.1:"$(pg_host_port)"/"$db") printf '%s' "$url" ;;
    *) die "refusing database URL for $db: not localhost:$(pg_host_port) (container $PG_CONTAINER) ending in /$db" ;;
  esac
}

read_owner() {
  local file="$OWNERS/$1/owner"
  [ -f "$file" ] || die "no owner record for '$1' (not created by this script, or already torn down)"
  # shellcheck disable=SC1090
  . "$file"
}

cmd_new() {
  local name="${1:-}" branch="${2:-}"
  [[ "$name" =~ $NAME_PATTERN ]] || die "usage: new <name> <branch>; name must match $NAME_PATTERN"
  [[ ! "$name" =~ $RESERVED_NAME_SEGMENT ]] || die "name '$name' has a test/e2e/dev segment; pick another"
  [ -n "$branch" ] || die "usage: new <name> <branch>  (branch like chore/kebab-desc)"
  # Distinct suffixes and hyphen-only names keep every name's two databases disjoint from
  # every other name's.
  local path="$WORKTREES/$name" slug="noma_dmrv_wt_${name//-/_}"
  local dev_db="${slug}_dev" test_db="${slug}_test"
  docker exec "$PG_CONTAINER" true 2>/dev/null || die "container $PG_CONTAINER is not running (docker start $PG_CONTAINER)"
  [ ! -e "$path" ] || die "$path already exists"
  # Before any claim, so a failure here leaves nothing behind.
  local dev_url test_url
  dev_url="$(db_url_for "$dev_db")"
  test_url="$(db_url_for "$test_db")"

  mkdir -p "$PORT_CLAIMS"
  mkdir "$OWNERS/$name" 2>/dev/null || die "name '$name' is already claimed ($OWNERS/$name)"
  local port=""
  for ((p = PORT_FIRST; p <= PORT_LAST; p++)); do
    case "$RESERVED_PORTS" in *" $p "*) continue ;; esac
    port_listening "$p" && continue
    if mkdir "$PORT_CLAIMS/$p" 2>/dev/null; then port="$p"; break; fi
  done
  [ -n "$port" ] || { rmdir "$OWNERS/$name"; die "no free port in $PORT_FIRST-$PORT_LAST"; }
  echo "$name" > "$PORT_CLAIMS/$port/name"

  for db in "$dev_db" "$test_db"; do
    if db_exists "$db"; then
      rm -rf "$PORT_CLAIMS/$port"; rmdir "$OWNERS/$name"
      die "database $db already exists and is not ours; pick another name"
    fi
  done
  local branch_created=1
  git -C "$MAIN" show-ref --verify --quiet "refs/heads/$branch" && branch_created=0

  # Record first, so a failure below leaves something teardown can clean up. Databases are
  # added to the record only once CREATE succeeds, so teardown never drops one it did not make.
  {
    printf 'OWNER_SESSION=%q\n' "$SESSION"
    printf 'CREATED_AT=%q\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'WT_PATH=%q\n' "$path"
    printf 'WT_BRANCH=%q\n' "$branch"
    printf 'WT_BRANCH_CREATED=%q\n' "$branch_created"
    printf 'WT_PORT=%q\n' "$port"
    printf 'WT_DEV_DB=%q\n' "$dev_db"
    printf 'WT_TEST_DB=%q\n' "$test_db"
    printf 'WT_DBS_CREATED=%q\n' ""
  } > "$OWNERS/$name/owner"
  trap 'echo "worktree: new failed part-way; clean up with: scripts/worktree.sh teardown $name" >&2' ERR

  git -C "$MAIN" fetch --quiet origin staging
  if [ "$branch_created" = 1 ]; then
    # --no-track: otherwise the branch tracks origin/staging and a bare push targets staging.
    git -C "$MAIN" worktree add --quiet --no-track -b "$branch" "$path" "$BASE_REF"
  else
    git -C "$MAIN" worktree add --quiet "$path" "$branch"
  fi

  # By name only: `cp .env*` would overwrite the tracked .env.example.
  cp "$MAIN/.env.local" "$path/.env.local"
  cp "$MAIN/.env.test" "$path/.env.test"
  set_env "$path/.env.local" DATABASE_URL "$dev_url"
  set_env "$path/.env.local" NEXT_PUBLIC_APP_URL "http://localhost:$port"
  set_env "$path/.env.test" DATABASE_URL "$dev_url"
  set_env "$path/.env.test" TEST_DATABASE_URL "$test_url"
  set_env "$path/.env.test" NEXT_PUBLIC_APP_URL "http://localhost:$port"

  for db in "$dev_db" "$test_db"; do
    psql_admin "CREATE DATABASE \"$db\"" >/dev/null
    WT_DBS_CREATED="${WT_DBS_CREATED:-} $db"
    printf 'WT_DBS_CREATED=%q\n' "$WT_DBS_CREATED" >> "$OWNERS/$name/owner"
  done

  info "installing dependencies"
  (cd "$path" && pnpm install --frozen-lockfile --silent)
  info "resetting $dev_db"
  (cd "$path" && DATABASE_URL="$dev_url" pnpm -s db:reset >/dev/null)
  info "migrating $test_db"
  (cd "$path" && DATABASE_URL="$test_url" pnpm -s db:migrate >/dev/null)
  trap - ERR

  cat <<EOF

worktree '$name' ready
  path     $path
  branch   $branch
  port     $port   (NEXT_PUBLIC_APP_URL in .env.local and .env.test)
  dev DB   $dev_db   (seed with: pnpm db:seed)
  test DB  $test_db   (Vitest, via TEST_DATABASE_URL)

Start the dev server in your own terminal (agent background commands stop after 2 hours):
  cd "$path" && pnpm exec next dev -p $port
Playwright in the worktree targets :$port and starts that server itself if none is running.
EOF
}

pr_state() {
  command -v gh >/dev/null || { echo "?"; return; }
  (cd "$MAIN" && gh pr list --head "$1" --state all --json number,state \
    --jq 'if length == 0 then "no PR" else (.[0] | "#\(.number) \(.state)") end' 2>/dev/null) || echo "?"
}

cmd_status() {
  local known_paths=" " known_dbs=" " found=0
  local dbs
  dbs="$(psql_admin "SELECT datname FROM pg_database WHERE datname LIKE 'noma\_dmrv\_%' ORDER BY 1" 2>/dev/null || echo "")"
  printf '%-22s %-6s %-9s %-14s %-40s %s\n' NAME PORT SERVER PR BRANCH OWNER
  for dir in "$OWNERS"/*/; do
    [ -f "$dir/owner" ] || continue
    found=1
    local name; name="$(basename "$dir")"
    (
      read_owner "$name"
      local server="down" missing=""
      port_listening "$WT_PORT" && server="up"
      [ -d "$WT_PATH" ] || missing="$missing worktree"
      for db in ${WT_DBS_CREATED:-}; do
        printf '%s\n' "$dbs" | grep -qx "$db" || missing="$missing $db"
      done
      printf '%-22s %-6s %-9s %-14s %-40s %s\n' "$name" "$WT_PORT" "$server" "$(pr_state "$WT_BRANCH")" "$WT_BRANCH" "$OWNER_SESSION"
      [ -z "$missing" ] || echo "    missing:$missing"
    )
    # shellcheck disable=SC1090,SC1091
    known_paths="$known_paths$(. "$dir/owner"; printf '%s' "$WT_PATH") "
    known_dbs="$known_dbs$(. "$dir/owner"; printf '%s %s' "$WT_DEV_DB" "$WT_TEST_DB") "
  done
  [ "$found" = 1 ] || echo "(no managed worktrees)"

  echo
  echo "Not managed by this script (inspect before removing; another session may own them):"
  local stray=0
  while IFS= read -r line; do
    case "$line" in worktree\ *) ;; *) continue ;; esac
    local wt="${line#worktree }"
    [ "$wt" = "$MAIN" ] && continue
    case "$known_paths" in *" $wt "*) continue ;; esac
    echo "  worktree  $wt"; stray=1
  done < <(git -C "$MAIN" worktree list --porcelain)
  for db in $dbs; do
    case "$db" in noma_dmrv_dev | noma_dmrv_test) continue ;; esac
    case "$known_dbs" in *" $db "*) continue ;; esac
    echo "  database  $db"; stray=1
  done
  [ "$stray" = 1 ] || echo "  (none)"
}

# Stop every process whose working directory is inside the worktree (a dev server and the
# pnpm wrapper that launched it) and wait for them to exit, or they write into .next while
# git removes the directory. Processes running elsewhere are never touched.
stop_processes_in() {
  local dir="$1" pids="" pid cwd waited=0 ancestors=" " ancestor=$$
  # Never this script or whatever launched it.
  while [ -n "$ancestor" ] && [ "$ancestor" -gt 1 ]; do
    ancestors="$ancestors$ancestor "
    ancestor="$(ps -o ppid= -p "$ancestor" 2>/dev/null | tr -d ' ')"
  done
  while IFS= read -r line; do
    case "$line" in
      p*) pid="${line#p}" ;;
      n*)
        cwd="${line#n}"
        case "$ancestors" in *" $pid "*) continue ;; esac
        case "$cwd" in "$dir" | "$dir"/*) pids="$pids $pid" ;; esac
        ;;
    esac
  done < <(lsof -nP -d cwd -Fpn 2>/dev/null)
  [ -n "$pids" ] || return 0
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  info "stopped processes running in the worktree:$pids"
  while [ "$waited" -lt "$STOP_WAIT_TICKS" ]; do
    local alive=0
    for pid in $pids; do kill -0 "$pid" 2>/dev/null && alive=1; done
    [ "$alive" = 1 ] || return 0
    sleep "$STOP_TICK_SECONDS"; waited=$((waited + 1))
  done
  die "processes still running after waiting $STOP_WAIT_TICKS x ${STOP_TICK_SECONDS}s:$pids; stop them and rerun (nothing was removed)"
}

cmd_teardown() {
  local name="${1:-}" force="${2:-}"
  [ -n "$name" ] || die "usage: teardown <name> [--force]"
  read_owner "$name"
  if [ "$OWNER_SESSION" != "$SESSION" ] && [ "$force" != "--force" ]; then
    die "'$name' belongs to session $OWNER_SESSION; check with that session, then rerun with --force"
  fi
  case "$PWD/" in
    "$WT_PATH"/*) die "run teardown from outside $WT_PATH (e.g. cd \"$MAIN\")" ;;
  esac

  if [ -d "$WT_PATH" ]; then
    git -C "$MAIN" worktree list --porcelain | grep -qxF "worktree $WT_PATH" ||
      die "$WT_PATH exists but is no longer a git worktree (an interrupted teardown?); inspect it, delete it, rerun"
    [ -z "$(git -C "$WT_PATH" status --porcelain)" ] ||
      die "$WT_PATH has uncommitted changes; commit or discard them first (nothing was removed)"
    stop_processes_in "$WT_PATH"
    port_listening "$WT_PORT" && info "something else still listens on :$WT_PORT; left running"
    git -C "$MAIN" worktree remove "$WT_PATH"
    info "removed worktree $WT_PATH"
  elif git -C "$MAIN" worktree list --porcelain | grep -qxF "worktree $WT_PATH"; then
    # Directory gone but still registered: drop only this registration, never a repo-wide prune.
    git -C "$MAIN" worktree remove --force "$WT_PATH"
  fi

  for db in ${WT_DBS_CREATED:-}; do
    psql_admin "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)" >/dev/null
    info "dropped $db"
  done

  if [ "$WT_BRANCH_CREATED" = 1 ] && git -C "$MAIN" show-ref --verify --quiet "refs/heads/$WT_BRANCH"; then
    # -d refuses an unmerged branch, so unpushed work survives as a branch.
    if git -C "$MAIN" branch -d "$WT_BRANCH" >/dev/null 2>&1; then
      info "deleted merged branch $WT_BRANCH"
    else
      info "kept branch $WT_BRANCH (not merged; delete it yourself once it is)"
    fi
  fi

  rm -rf "$PORT_CLAIMS/$WT_PORT" "$OWNERS/$name"
  info "'$name' torn down"
}

case "${1:-}" in
  new) shift; cmd_new "$@" ;;
  status) cmd_status ;;
  teardown) shift; cmd_teardown "$@" ;;
  *) sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
