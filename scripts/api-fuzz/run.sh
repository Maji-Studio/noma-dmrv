#!/usr/bin/env bash
set -euo pipefail

readonly SCHEMATHESIS_VERSION=4.29.3
readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${API_FUZZ_BASE_URL:?Set API_FUZZ_BASE_URL to the server URL including /api/v1}"
: "${API_FUZZ_KEY:?Set API_FUZZ_KEY to the seeded API key}"
export API_FUZZ_BASE_URL API_FUZZ_KEY
cd "$REPO_ROOT"
# Generate on every run so later operations are included without a filter list.
pnpm openapi:generate
exec uvx "schemathesis@${SCHEMATHESIS_VERSION}" --config-file schemathesis.toml run openapi/v1.json "$@"
