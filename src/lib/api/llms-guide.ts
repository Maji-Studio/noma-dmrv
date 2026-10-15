import { DOCUMENT_DOWNLOAD_TTL_MINUTES } from "@/config/documents";
import { DOCUMENT_GUIDANCE, DOCUMENT_TYPE_GUIDANCE } from "@/lib/operations/document-guidance";
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
- POST /orders requires orders:write and an Idempotency-Key, including dry runs. PATCH /orders/{id} requires orders:write and If-Match. Omitted fields stay unchanged; customerLocationId is required on create and cannot be null or empty on PATCH. Changing customerId requires a customerLocationId belonging to the new customer; otherwise the response is 422 validation_failed (Delivery location belongs to a different customer). Relationships freeze once any delivery exists. DELETE requires orders:delete and If-Match, and only works without deliveries, including archived deliveries. All writes accept ?dryRun=true. Quantity is requested wet kg, packaging defaults to the organization setting, and orderDate is a calendar date.
- MCP: call find_customers, find_customer_locations and find_formulations first, and whoami for facility ids. Use record_order, update_order and delete_order; requestKey is required except on dry runs, and expectedVersion from get_order is required on update and delete. find_orders and get_order return the REST representations. The balance is not a reservation; call it before recording a delivery.
- GET /orders/{idOrCode}/balance requires orders:read. ${readDescriptions.orderBalance}
- Find product bins through GET /storage-locations?type=product_bin&formulationId=<UUID>, optionally with facilityId. formulationId is null until a product bin is claimed, and on other bin types.
`;

export const deliveryGuide = `## Deliveries

- GET /deliveries and /deliveries/{idOrCode} require deliveries:read. ${readDescriptions.deliveries}
- POST /deliveries requires deliveries:write and an Idempotency-Key, including dry runs. It sends finished product from a product bin to a customer against an order and deducts from the bin. Feedstock intake uses POST /feedstocks. Read orders, matching product bins and bin stock first. Masses are wet kg; moisture is percent of wet mass. On create it is the reading; with sources, each source carries its own reading and the server stores the overall (1 minus solids divided by wet mass) times 100, including ingredient solids. deliveredAt resolves in the order facility time zone and cannot be in the future. Distances are one-way km; the server counts the round trip. distanceKmOverride must be above 0; omit it to use the customer location distance.
- All delivery writes accept ?dryRun=true and answer 200 for previews. A create dry run shows the products drawn in allocations plus stockEffects and basisFingerprint. Pass that basisFingerprint on the real write; a stale basis answers 409 stock_basis_changed with a fresh stock preview when available. Committed creates answer 201 with Location, ETag and allocations. The non-blocking warning asks you to upload the bill of lading as a delivery document of type bill_of_lading.
- PATCH /deliveries/{id} requires deliveries:write and If-Match, UUID only. Only code, driverId, vehicleId and distance metadata can change. Omission preserves fields; null clears clearable fields. Use an optional Idempotency-Key to recover a lost response after later edits. PATCH adds no bill-of-lading warning. Mass, moisture and time corrections stay in the app. Deliveries cannot be deleted.
- Read GET /storage-locations/{idOrCode}/stock-movements with biochar-products:read for the drawn products. Filter the returned rows by deliveryId.
- MCP: find_deliveries and get_delivery use deliveries:read; record_delivery and update_delivery use deliveries:write. requestKey is required except on dry runs; update needs expectedVersion from get_delivery. Call find_orders, get_order_balance for remaining wet kg, find_storage_locations with type=product_bin and the order formulationId, then get_bin_stock for drawOrder and sub-bins. This is not log_feedstock_delivery. Never invent moisture readings; ask the operator. Top-level moisturePercent is ignored with sources. deliveredAt also accepts { date, time }. Read drawn products with find_output_stock_movements (biochar-products:read).
- Bin stock exposes drawOrder: without sources, a split bin draws oldest_first or newest_first; mix bins return null. The sub-bin list stays oldest first.
`;

export const llmsGuide = `# noma data-entry API v1

Public contract: /api/v1/openapi.json
Base URL: /api/v1

${domainGuide}
${biocharStockGuide}
${labSampleGuide}
${orderGuide}
${deliveryGuide}
## Applications

Find deliveries with GET /deliveries?hasRemainingMass=true, then read GET /deliveries/{idOrCode}/application-balance first. It returns remaining wet kilograms, the earliest application date and site defaults from one snapshot. Mass is wet kg of delivered product and dry biochar mass is derived by the server. Field size is hectares and applicationDate is a calendar date on the delivery facility's clock. GET /applications and /applications/{idOrCode} require applications:read. POST /applications with Idempotency-Key; PATCH and DELETE the UUID path with If-Match from the latest GET. DELETE requires applications:delete. Supply raw WGS 84 GeoJSON under the JSON body cap; add larger boundaries in the app. Never invent field size or GPS. Full geometry is a separate read at /applications/{idOrCode}/boundary. Application photos and PDFs use /applications/{idOrCode}/documents with applications:read for reads and applications:write for upload requests and confirmation.

## Documents

Documents belong to a record. Read them under /feedstocks/{idOrCode}/documents, /deliveries/{idOrCode}/documents, /lab-samples/{idOrCode}/documents or /applications/{idOrCode}/documents using the record's read scope. Lists show uploaded files by default. Read one file at {record path}/documents/{documentId}. Its /content route redirects to a signed link that expires in ${DOCUMENT_DOWNLOAD_TTL_MINUTES} minutes; follow that link without the API key. Archived records remain readable.

${DOCUMENT_GUIDANCE}

MCP: find_documents and get_document_download_url require the chosen owner's read scope. request_document_upload and confirm_document_upload require its write scope. ownerType is feedstock, delivery or lab_sample. ${DOCUMENT_TYPE_GUIDANCE} request_document_upload requires requestKey; repeating it returns a fresh link while pending, or upload: null with a warning naming why it is unavailable. Retry using the returned owner UUID. confirm_document_upload takes neither requestKey nor expectedVersion. Neither document write offers a dry run. Confirm refusals are isError results; follow the issue pointer and reason. REST uses POST on the record's documents path with Idempotency-Key to request, then POST on documents/{documentId}/confirm without If-Match to confirm.

## REST requests

- Authenticate private routes with Authorization: Bearer <key> only. Keys start with ${API_KEY_LIVE_PREFIX} or ${API_KEY_TEST_PREFIX}. Cookies and x-api-key do not authenticate.
- GET /me returns the credential organization, active facilities, role, scopes and expiry. Reads require the resource :read scope. Feedstock creates and updates require feedstocks:write; deletes require feedstocks:delete. Production run creates and updates require production-runs:write; deletes require production-runs:delete. Biochar product creates and updates, and loss and count postings on output bins, require biochar-products:write; products cannot be deleted. /me needs no scope. Domain guards still apply.
- Resolve reference UUIDs through read-only facilities, suppliers, feedstock-types, storage-locations, vehicles, drivers and reactors. Biochar products (biochar-products:read) and formulations (formulations:read) are read-only lookups; /storage-locations/{idOrCode}/stock-movements lists a biochar or product bin's posted movements, newest first (biochar-products:read), and POST on it records a loss or count (UUID only). Credit batches (credit-batches:read) are a read-only lookup. A lab sample (lab-samples:read) belongs to one credit batch, and the batch's facility, shown in the facility's durabilityOption and timeZone, sets its tier and clock. POST /lab-samples (lab-samples:write, Idempotency-Key required) records one replicate and PATCH moves or edits it; DELETE needs lab-samples:delete. Writes return the sample and any calculated ratios or certification gaps in warnings. Supplier locations require the parent UUID. GET detail accepts UUID or exact code; PATCH and DELETE require UUID.
- Send JSON for POST and PATCH. DELETE may omit the body or send zero bytes without Content-Type; a non-empty body must be an empty JSON object with Content-Type: application/json. Field names state units: masses are kilograms, distances kilometres, moisture is percent 0 to 100 (feedstock intake requires below 100). POST /feedstocks returns an array, one item per receiving bin allocation. PATCH omission preserves a value; null clears clearable fields; zero stays zero. Unknown fields are rejected.
- Use one Idempotency-Key per intended write and reuse it on retries. Required on every POST create, including dry runs, recommended for PATCH and DELETE. Keys use 1 to ${API_IDEMPOTENCY_KEY_MAX_LENGTH} visible ASCII characters, are credential-scoped and retained for ${IDEMPOTENCY_RETENTION_DAYS} days. Idempotent-Replayed: true marks a replay.
- Read the resource's ETag before PATCH or DELETE and send that exact strong tag in If-Match. Missing, weak or wildcard tags return 428; stale tags return 412 with current. Read and reconcile before attempting a new write.
- Writes accept ?dryRun=true: domain guards run, then the transaction rolls back and external effects are skipped. Ids and codes are provisional. Dry-run bodies include stockEffects with each changed bin’s before, after and delta in kilograms. Dry-Run: true marks dry runs; ETag is absent on dry runs. Dry runs do not consume or replay keys; an already committed key returns 409. POST dry runs require a key.
- Product and movement dry runs also return basisFingerprint. Send it as basisFingerprint on the real write to refuse it if stock moved; 409 stock_basis_changed then carries preview, a fresh basisFingerprint and stockEffects to write against.
- Lists use newest-first (createdAt, id) cursor pagination, default ${API_LIST_DEFAULT_LIMIT} and maximum ${API_LIST_MAX_LIMIT}. Send nextCursor as cursor with unchanged filters; null means the end. No totals or include. q searches a literal case-insensitive code/name prefix; code matches exactly. Feedstocks search code only; supplier locations search name only.
- Run start and end times take RFC 3339 with an explicit offset, or facility-local { date, time }; offset-less strings are refused. Responses return UTC instants.
- Errors use application/problem+json with code, retryable, errors containing JSON pointers and safe metadata, and optional conflict, blockers or current. Follow retryable and Retry-After seconds. 429 is rate limited; 409 idempotency_in_progress means wait and retry the same key. Retryable 500 deadline_exceeded or outcome_unknown requires the same key; outcome_unknown may already have committed. 503 temporarily disables writes.
- RateLimit-Limit, RateLimit-Remaining and RateLimit-Reset describe the tightest request bucket; Reset is seconds. Failed writes and dry runs consume the write budget. X-Request-Id identifies requests.
`;
