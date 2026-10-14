import { readDescriptions } from "@/lib/operations/read-descriptions";
import { API_IDEMPOTENCY_KEY_MAX_LENGTH, API_LIST_DEFAULT_LIMIT, API_LIST_MAX_LIMIT } from "@/config/api-rest";
import { API_KEY_LIVE_PREFIX, API_KEY_TEST_PREFIX } from "@/config/api-keys";
import { IDEMPOTENCY_RETENTION_DAYS } from "@/config/operations";
import { BIOCHAR_PRODUCT_MASS, OUTPUT_BIN_STOCK_ETAG, OUTPUT_BIN_STOCK_SOURCES, FEEDSTOCK_UNITS, LAB_SAMPLE_BATCHES, LAB_SAMPLE_RATIOS, LAB_SAMPLE_TIMES, LAB_SAMPLE_UNITS, LAB_SAMPLE_WARNINGS, OUTPUT_STOCK_BASIS, OUTPUT_STOCK_COUNT, OUTPUT_STOCK_NO_CORRECTIONS, OUTPUT_STOCK_TIMES, PRODUCTION_RUN_GUIDANCE, UNTRUSTED_TEXT } from "@/lib/operations/agent-guidance";

export const domainGuide = `## Feedstock intake

- Operators weigh wet mass as received. Dry mass is derived from wet mass and moisture, not weighed for bin stock. ${FEEDSTOCK_UNITS}
- A feedstock record is material received into one feedstock bin, with its feedstock type, supplier, wet mass, moisture and delivery date. One delivery logged into several bins creates one record per receiving bin.
- Business dates are the facility's local YYYY-MM-DD. Use its today and IANA timeZone from whoami or /me, never the device or model clock.
- Resolve ids through lookups. Read the current version before updating or deleting.
- Ask for missing required values such as moisture. Never invent them.
- ${UNTRUSTED_TEXT}

## Production runs

- ${PRODUCTION_RUN_GUIDANCE}
- Resolve the reactor and bins in the run facility before writing.
`;

/**
 * Biochar product and bin stock guidance. It lives in llms.txt and the MCP tool
 * descriptions rather than the MCP server instructions, which stay under 2000 characters.
 */
export const biocharStockGuide = `## Biochar products and bin stock

- ${BIOCHAR_PRODUCT_MASS}
- Losses and counts are posted on a biochar or product bin. ${OUTPUT_STOCK_COUNT}
- Read GET /storage-locations/{idOrCode}/stock or get_bin_stock (biochar-products:read) for current stock. ${OUTPUT_BIN_STOCK_SOURCES} ${OUTPUT_BIN_STOCK_ETAG}
- ${OUTPUT_STOCK_TIMES}
- ${OUTPUT_STOCK_BASIS}
- ${OUTPUT_STOCK_NO_CORRECTIONS}
`;

/** Lab sample guidance lives in llms.txt and the MCP tool descriptions, not the MCP server instructions, which stay under 2000 characters. */
export const labSampleGuide = `## Lab samples

- ${LAB_SAMPLE_BATCHES}
- ${LAB_SAMPLE_UNITS}
- ${LAB_SAMPLE_TIMES}
- ${LAB_SAMPLE_RATIOS}
- ${LAB_SAMPLE_WARNINGS}
`;

export const orderGuide = `## Customers and orders

- GET /customers and /customers/{idOrCode} require customers:read and return ids, codes and names without contact fields. GET /customers/{idOrCode}/locations accepts a parent UUID or code and returns destinations with GPS and one-way distance. The server counts the round trip.
- GET /orders and /orders/{idOrCode} require orders:read. ${readDescriptions.orders} Quantity is requested wet product mass in kilograms, stored with 32-bit floating-point precision (about 6 significant decimal digits). Large quantities do not preserve 0.001 kg steps.
- POST /orders requires orders:write and an Idempotency-Key, including dry runs. PATCH /orders/{id} requires orders:write and If-Match. Omitted fields stay unchanged; customerLocationId null clears. Relationships freeze once any delivery exists. DELETE requires orders:delete and If-Match, and only works without deliveries, including archived deliveries. All writes accept ?dryRun=true. Quantity is requested wet kg, packaging defaults to the organization setting, and orderDate is a calendar date.
- GET /orders/{idOrCode}/balance requires orders:read. ${readDescriptions.orderBalance}
- Find product bins through GET /storage-locations?type=product_bin&formulationId=<UUID>, optionally with facilityId. formulationId is null until a product bin is claimed, and on other bin types.
`;

export const llmsGuide = `# noma data-entry API v1

Public contract: /api/v1/openapi.json
Base URL: /api/v1

${domainGuide}
${biocharStockGuide}
${labSampleGuide}
${orderGuide}
## REST requests

- Authenticate private routes with Authorization: Bearer <key> only. Keys start with ${API_KEY_LIVE_PREFIX} or ${API_KEY_TEST_PREFIX}. Cookies and x-api-key do not authenticate.
- GET /me returns the credential organization, active facilities, role, scopes and expiry. Reads require the resource :read scope. Feedstock creates and updates require feedstocks:write; deletes require feedstocks:delete. Production run creates and updates require production-runs:write; deletes require production-runs:delete. Biochar product creates and updates, and loss and count postings on output bins, require biochar-products:write; products cannot be deleted. /me needs no scope. Domain guards still apply.
- Resolve reference UUIDs through read-only facilities, suppliers, feedstock-types, storage-locations, vehicles, drivers and reactors. Biochar products (biochar-products:read) and formulations (formulations:read) are read-only lookups; /storage-locations/{idOrCode}/stock-movements lists a biochar or product bin's posted movements, newest first (biochar-products:read), and POST on it records a loss or count (UUID only). Credit batches (credit-batches:read) are a read-only lookup. A lab sample (lab-samples:read) belongs to one credit batch, and the batch's facility, shown in the facility's durabilityOption and timeZone, sets its tier and clock. POST /lab-samples (lab-samples:write, Idempotency-Key required) records one replicate and PATCH moves or edits it; DELETE needs lab-samples:delete. Writes return the sample and any calculated ratios or certification gaps in warnings. Supplier locations require the parent UUID. GET detail accepts UUID or exact code; PATCH and DELETE require UUID.
- Send JSON for POST and PATCH. DELETE may omit the body or send zero bytes without Content-Type; a non-empty body must be an empty JSON object with Content-Type: application/json. Field names state units: masses are kilograms, distances kilometres, moisture is percent 0 to 100. POST /feedstocks returns an array, one item per receiving bin allocation. PATCH omission preserves a value; null clears clearable fields; zero stays zero. Unknown fields are rejected.
- Use one Idempotency-Key per intended write and reuse it on retries. Required on every POST create, including dry runs, recommended for PATCH and DELETE. Keys use 1 to ${API_IDEMPOTENCY_KEY_MAX_LENGTH} visible ASCII characters, are credential-scoped and retained for ${IDEMPOTENCY_RETENTION_DAYS} days. Idempotent-Replayed: true marks a replay.
- Read the resource's ETag before PATCH or DELETE and send that exact strong tag in If-Match. Missing, weak or wildcard tags return 428; stale tags return 412 with current. Read and reconcile before attempting a new write.
- Writes accept ?dryRun=true: domain guards run, then the transaction rolls back and external effects are skipped. Ids and codes are provisional. Dry-run bodies include stockEffects with each changed bin’s before, after and delta in kilograms. Dry-Run: true marks dry runs; ETag is absent on dry runs. Dry runs do not consume or replay keys; an already committed key returns 409. POST dry runs require a key.
- Product and movement dry runs also return basisFingerprint. Send it as basisFingerprint on the real write to refuse it if stock moved; 409 stock_basis_changed then carries preview, a fresh basisFingerprint and stockEffects to write against.
- Lists use newest-first (createdAt, id) cursor pagination, default ${API_LIST_DEFAULT_LIMIT} and maximum ${API_LIST_MAX_LIMIT}. Send nextCursor as cursor with unchanged filters; null means the end. No totals or include. q searches a literal case-insensitive code/name prefix; code matches exactly. Feedstocks search code only; supplier locations search name only.
- Run start and end times take RFC 3339 with an explicit offset, or facility-local { date, time }; offset-less strings are refused. Responses return UTC instants.
- Errors use application/problem+json with code, retryable, errors containing JSON pointers and safe metadata, and optional conflict, blockers or current. Follow retryable and Retry-After seconds. 429 is rate limited; 409 idempotency_in_progress means wait and retry the same key. Retryable 500 deadline_exceeded or outcome_unknown requires the same key; outcome_unknown may already have committed. 503 temporarily disables writes.
- RateLimit-Limit, RateLimit-Remaining and RateLimit-Reset describe the tightest request bucket; Reset is seconds. Failed writes and dry runs consume the write budget. X-Request-Id identifies requests.
`;
