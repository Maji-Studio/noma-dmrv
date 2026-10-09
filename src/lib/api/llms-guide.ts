import { API_IDEMPOTENCY_KEY_MAX_LENGTH, API_LIST_DEFAULT_LIMIT, API_LIST_MAX_LIMIT } from "@/config/api-rest";
import { API_KEY_LIVE_PREFIX, API_KEY_TEST_PREFIX } from "@/config/api-keys";
import { IDEMPOTENCY_RETENTION_DAYS } from "@/config/operations";
import { FEEDSTOCK_UNITS, UNTRUSTED_TEXT } from "@/lib/operations/agent-guidance";

export const domainGuide = `## Feedstock intake

- Operators weigh wet mass as received. Dry mass is derived from wet mass and moisture, not weighed for bin stock. ${FEEDSTOCK_UNITS}
- A feedstock record is material received into one feedstock bin, with its feedstock type, supplier, wet mass, moisture and delivery date. One delivery logged into several bins creates one record per receiving bin.
- Business dates are the facility's local YYYY-MM-DD. Use its today and IANA timeZone from whoami or /me, never the device or model clock.
- Read before writing: resolve ids through lookups and read the current version before an update or delete.
- Never invent a required value the operator did not give, such as moisture. Ask the operator for it.
- ${UNTRUSTED_TEXT}
`;

export const llmsGuide = `# noma data-entry API v1

Public contract: /api/v1/openapi.json
Base URL: /api/v1

${domainGuide}
## REST requests

- Authenticate private routes with Authorization: Bearer <key> only. Keys start with ${API_KEY_LIVE_PREFIX} or ${API_KEY_TEST_PREFIX}. Cookies and x-api-key do not authenticate.
- GET /me returns the credential organization, active facilities, role, scopes and expiry. Reads require the resource :read scope. Feedstock creates and updates require feedstocks:write; deletes require feedstocks:delete. /me needs no scope. Domain guards still apply.
- Resolve reference UUIDs through read-only facilities, suppliers, feedstock-types, storage-locations, vehicles and drivers. Supplier locations require the parent UUID. GET detail accepts UUID or exact code; PATCH and DELETE require UUID.
- Send JSON for POST and PATCH. DELETE may omit the body; a supplied body must be an empty JSON object. Field names state units: masses are kilograms, distances kilometres, moisture is percent 0 to 100. POST /feedstocks returns an array, one item per receiving bin allocation. PATCH omission preserves a value; null clears clearable fields; zero stays zero. Unknown fields are rejected.
- Use one Idempotency-Key per intended write and reuse it on retries. Required for committed POST creates, recommended for PATCH and DELETE. Keys use 1 to ${API_IDEMPOTENCY_KEY_MAX_LENGTH} visible ASCII characters, are credential-scoped and retained for ${IDEMPOTENCY_RETENTION_DAYS} days. Idempotent-Replayed: true marks a replay.
- Read a feedstock's ETag before PATCH or DELETE and send that exact strong tag in If-Match. Missing, weak or wildcard tags return 428; stale tags return 412 with current. Read and reconcile before attempting a new write.
- Writes accept ?dryRun=true: domain guards run, then the transaction rolls back and external effects are skipped. Ids and codes are provisional. Dry-Run: true marks previews; ETag is absent on dry runs. Dry runs do not consume or replay keys; an already committed key returns 409. POST dry runs may omit the key.
- Lists use newest-first (createdAt, id) cursor pagination, default ${API_LIST_DEFAULT_LIMIT} and maximum ${API_LIST_MAX_LIMIT}. Send nextCursor as cursor with unchanged filters; null means the end. No totals or include. q searches a literal case-insensitive code/name prefix; code matches exactly. Feedstocks search code only; supplier locations search name only.
- Event instants are RFC 3339 UTC.
- Errors use application/problem+json with code, retryable, errors containing JSON pointers and safe metadata, and optional conflict, blockers or current. Follow retryable and Retry-After seconds. 429 is rate limited; 409 idempotency_in_progress means wait and retry the same key. Retryable 500 deadline_exceeded or outcome_unknown requires the same key; outcome_unknown may already have committed. 503 temporarily disables writes.
- RateLimit-Limit, RateLimit-Remaining and RateLimit-Reset describe the tightest request bucket; Reset is seconds. Failed writes and dry runs consume the write budget. X-Request-Id identifies requests.
`;
