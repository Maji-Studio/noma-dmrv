#!/usr/bin/env bash
# Point-in-time audit observations. Creates and removes its own empty local DB.
set -euo pipefail
cd "$(dirname "$0")/../../../.."
audit_container=""
cleanup() {
  if [[ -n "$audit_container" ]]; then docker stop "$audit_container" >/dev/null; fi
}
trap cleanup EXIT
# These are intentionally non-secret credentials for a disposable loopback fixture.
audit_container=$(docker run --detach --rm --tmpfs /var/lib/postgresql:rw \
  --publish 127.0.0.1::5432 --env POSTGRES_PASSWORD=audit-local-only \
  --env POSTGRES_DB=noma_lifecycle_audit_test postgres:18-alpine)
audit_ready=false
for audit_attempt in {1..30}; do
  if docker exec "$audit_container" pg_isready -U postgres >/dev/null 2>&1; then
    audit_ready=true
    break
  fi
  sleep 1
done
if [[ "$audit_ready" != true ]]; then echo 'Disposable audit database did not become ready.' >&2; exit 1; fi
audit_bind=$(docker port "$audit_container" 5432/tcp)
audit_port=${audit_bind##*:}
export DATABASE_URL="postgresql://postgres:audit-local-only@127.0.0.1:${audit_port}/noma_lifecycle_audit_test"
NODE_ENV=development pnpm db:migrate
pnpm exec vitest run --config docs/archive/qa/2026-09-08-lifecycle-audit/simulation.config.ts --reporter=verbose
