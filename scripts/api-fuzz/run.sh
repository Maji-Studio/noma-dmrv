#!/usr/bin/env bash
set -euo pipefail

readonly SCHEMATHESIS_VERSION=4.29.3
readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${API_FUZZ_BASE_URL:?Set API_FUZZ_BASE_URL to the server URL including /api/v1}"
: "${API_FUZZ_FIXTURE:?Set API_FUZZ_FIXTURE to the private JSON file written by seed.ts}"
: "${API_FUZZ_KEY:?Set API_FUZZ_KEY to the seeded API key}"
export API_FUZZ_BASE_URL API_FUZZ_KEY API_FUZZ_FIXTURE
# Only ids/codes cross stdout here. Never print or evaluate the fixture key.
fixture_values="$(node --input-type=module - "$API_FUZZ_FIXTURE" <<'JS'
import { readFileSync } from 'node:fs';
const fixture = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const fields = {
  FACILITY: 'facility', SUPPLIER: 'supplier', FEEDSTOCK_TYPE: 'feedstockType',
  BIN: 'bin', DRIVER: 'driver', VEHICLE: 'vehicle', FEEDSTOCK: 'feedstock',
};
for (const [name, field] of Object.entries(fields)) {
  for (const suffix of ['Id', 'Code']) {
    const value = fixture[`${field}${suffix}`];
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new Error(`Missing or invalid fixture field: ${field}${suffix}`);
    }
    console.log(`API_FUZZ_${name}_${suffix.toUpperCase()}=${value}`);
  }
}
if (typeof fixture.supplierLocationId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(fixture.supplierLocationId)) {
  throw new Error('Missing or invalid fixture field: supplierLocationId');
}
console.log(`API_FUZZ_SUPPLIER_LOCATION_ID=${fixture.supplierLocationId}`);
if (typeof fixture.feedstockEtag !== 'string' || !/^"[1-9]\d*\.[1-9]\d*"$/.test(fixture.feedstockEtag)) {
  throw new Error('Missing or invalid fixture field: feedstockEtag');
}
console.log(`API_FUZZ_FEEDSTOCK_ETAG=${fixture.feedstockEtag}`);
JS
)"
while IFS='=' read -r name value; do
  export "$name=$value"
done <<< "$fixture_values"
cd "$REPO_ROOT"
# Generate on every run so later operations are included without a filter list.
pnpm openapi:generate
# Offline checks of the hooks against the pinned Schemathesis internals.
uvx --from "schemathesis==${SCHEMATHESIS_VERSION}" python scripts/api-fuzz/hooks.test.py
exec uvx "schemathesis@${SCHEMATHESIS_VERSION}" --config-file schemathesis.toml run openapi/v1.json "$@"
