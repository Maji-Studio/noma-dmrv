# Master data on REST and MCP

This guide covers supplier, customer and formulation reads and writes, including
initial locations, archive/restore and delete guards. Read it when integrating
master data through the [REST and MCP API](./api.md).

## Shared write contract

Creates generate codes. REST creates require `Idempotency-Key` even on dry runs;
MCP `requestKey` is optional only on dry runs. REST returns 201 with ETag and
Location; PATCH and commands return 200 with ETag; DELETE returns bodyless 204.
Writes accept UUIDs only, even where OpenAPI calls the path parameter `idOrCode`.
REST mutations require strong `If-Match`: missing is 428, stale is 412 with
`current`. MCP uses `expectedVersion` from the matching `find_*` tool.
Optional REST mutation keys replay before domain preconditions.

Every write supports `dryRun=true`, rolling back parent rows, children, distance
pairs and Activity events. REST dry runs return 200 without ETag or Location.
REST archive/restore accept an empty object or no body and bump the version once.
Repeated transitions with a current version return 409 at the entity-id pointer;
an old version returns 412. PATCH omission keeps, null clears and zero stays zero.
Unknown properties return 422. REST pointers appear in `errors`; MCP uses `issues`.

## Suppliers and customers

Parties use revision 2. Suppliers publish `sourceRegion`; customers publish
`cropType`; both publish `archivedAt`. Reads need `suppliers:read` or
`customers:read`: REST list/detail and nested location lists, and MCP
`find_suppliers`, `find_customers`, `find_supplier_locations` and
`find_customer_locations`. Contact details stay in the app.

| REST method and path | MCP tool | Scope |
|---|---|---|
| POST `/suppliers` | `create_supplier` | `suppliers:write` |
| PATCH `/suppliers/{id}` | `update_supplier` | `suppliers:write` |
| DELETE `/suppliers/{id}` | `delete_supplier` | `suppliers:delete` |
| POST `/suppliers/{id}/archive` | `archive_supplier` | `suppliers:write` |
| POST `/suppliers/{id}/restore` | `restore_supplier` | `suppliers:write` |
| POST `/customers` | `create_customer` | `customers:write` |
| PATCH `/customers/{id}` | `update_customer` | `customers:write` |
| DELETE `/customers/{id}` | `delete_customer` | `customers:delete` |
| POST `/customers/{id}/archive` | `archive_customer` | `customers:write` |
| POST `/customers/{id}/restore` | `restore_customer` | `customers:write` |

Create takes one party with 1 to 50 initial locations. Every location requires
country and both WGS 84 coordinates; customer locations also require a name.
Create returns `data` and `locations`. The last `isDefault: true` location wins;
otherwise the first location is the default. Optional `facilityDistances` pairs
use one-way km, from 0.001 to 20,000, and `manual`, `map_estimate` or `document`
evidence. Each facility appears once per location and must be active in this
Organization. The server counts the round trip. Customer locations also accept
`siteDescription` and `defaultSoilTemperatureC`; both parties' locations accept
`stateRegion` and `city`.

Names are unique per Organization, case and surrounding whitespace insensitive.
Create and rename conflicts return 409 at `/name`. Archived names and codes stay
reserved. An archived-name conflict includes the existing party id and
`archived: true` in metadata; restore it or choose another name.

Lists hide archived rows by default. REST `archived=true` and MCP `archived: true`
list only archived rows, including exact code searches. Cursors bind this filter;
a mismatched cursor returns 400. Detail and nested location reads remain available
under an archived party. Supplier locations publish `archivedAt: null`; customer
locations carry `archivedAt`. API location bodies list every stored facility pair,
including pairs for archived facilities; such a pair can be kept or cleared but
cannot be set.

Archive keeps existing references. Archived suppliers cannot be newly referenced
by intakes; archived customers cannot be newly referenced by orders. A changed
destination on the same archived customer is also refused. Kept references pass,
including deliveries and applications on an existing order when its customer or
formulation is archived. PATCH of an archived party returns 404 at `/supplierId`
or `/customerId` before stale-version and representation-revision checks.
Every location write, including delete, refuses an archived parent. Party delete
remains allowed when its dependency checks pass. Restore the parent before editing it or adding a new reference.

Supplier deletion is blocked by feedstock intakes, returning 409 at `/supplierId`.
Customer deletion is blocked by deliveries on its orders (including archived
deliveries) or registered storage sites on its locations, returning 409 at
`/customerId`. Orders without deliveries are deleted in the same transaction.
`customers:delete` alone authorizes this cascade; `orders:delete` is not required.
Blocker metadata identifies references.
An unused party, including an archived party, can be deleted together with its
locations and facility distance pairs. A blocked delete removes nothing.

## Party locations

Paths below are relative to `/api/v1`. Reads need the parent's read scope.
`GET /suppliers/{idOrCode}/locations/{locationId}` and
`GET /customers/{idOrCode}/locations/{locationId}` return a strong location ETag.
MCP exposes `get_supplier_location` and `get_customer_location`. Read the
location's version for a write, not its parent's version. Supplier parents use
UUIDs; customer reads also accept exact parent codes. A foreign or wrong-parent
location returns 404 at `/locationId`. Lists have no ETags.

| REST method and path | MCP tool | Scope |
|---|---|---|
| POST `/suppliers/{id}/locations` | `add_supplier_location` | `suppliers:write` |
| PATCH `/suppliers/{id}/locations/{locationId}` | `update_supplier_location` | `suppliers:write` |
| DELETE `/suppliers/{id}/locations/{locationId}` | `delete_supplier_location` | `suppliers:delete` |
| POST `/customers/{id}/locations` | `add_customer_location` | `customers:write` |
| PATCH `/customers/{id}/locations/{locationId}` | `update_customer_location` | `customers:write` |
| DELETE `/customers/{id}/locations/{locationId}` | `delete_customer_location` | `customers:delete` |
| POST `/customers/{id}/locations/{locationId}/archive` | `archive_customer_location` | `customers:write` |
| POST `/customers/{id}/locations/{locationId}/restore` | `restore_customer_location` | `customers:write` |

Add takes the same location fields as party create: country and both GPS
coordinates are required, as is the name for a customer location. Never invent
GPS. Optional fields include name, stateRegion, city, isDefault and
facilityDistances; customers also accept siteDescription and
defaultSoilTemperatureC. MCP add takes supplierId or customerId, without
locationId or expectedVersion. Committed adds return 201 with ETag and Location;
dry runs return 200 without either. REST add requires a fresh Idempotency-Key,
including dry runs. MCP requires requestKey only for committed writes.

PATCH keeps omitted fields, arrays and pairs. Null clears optional fields;
required GPS, country and customer name cannot be cleared. A supplied distance
pair must include distanceKm: null removes that pair, while a number must be
0.001 to 20,000 one-way km with its distanceSource. Facility ids must be unique
within the supplied array. Stored pairs for archived facilities remain in API
reads and ETags and can be retained or cleared, but cannot be set.

PATCH, DELETE, archive and restore use the location ETag in If-Match, or
expectedVersion in MCP. They accept optional idempotency keys; replay happens
before version and state checks. Missing If-Match is 428; stale is 412 with the
current location. A repeated archive with the old tag is 412, with the current
tag 409; replay with the original key returns its saved success. DELETE dry
runs return the pre-delete location; committed REST deletes return 204. Every
write supports dry runs and rolls back rows, sibling defaults, distance fills,
Activity and document retirement.

Customer location lists hide archived rows by default; archived=true selects
only archived rows and is bound into the cursor. Detail reads retain archived
locations, including under archived parents. Resolve an old order's destination
through that detail read or archived=true. New or changed order destinations
must be active; an unchanged archived destination remains valid for existing
orders, deliveries and applications. PATCH on an archived location returns 404
before stale-version or revision checks; restore it first.

Archive keeps order references, distance pairs and registered storage sites.
The last active customer location cannot be archived. Archiving the default
promotes the first active sibling in the normal location order, bumps both
versions and returns a default-moved warning. Restore takes the default only
when none exists. Parent versions do not change. Supplier locations have no
archive operation. Customer location deletion is refused when any order uses
it or it is a registered storage site; both refusals say "Archive it instead."
An unused archived customer location can be deleted under an active parent.

### Registered storage sites and distance warnings

Registered customer locations protect their name and GPS. Q85 allows an edit
only when rebuilding every mapping's registry request produces exactly its
stored payload hash. There is no coordinate tolerance for this local check.
Other fields can change. A forbidden name or GPS change returns
certification_locked and asks the operator to add a new location.

Registration holds an exclusive site fence across the remote request. Protected
location edits, location deletion and customer deletion try a shared fence;
a busy registration returns retryable 409 conflict. Location writers do not
block each other on this fence. The stored mapping still blocks deletion after
its application and delivery are gone. Pair-only edits do not take this fence.
Archive and restore keep the mapping and do not need the registration fence.

Distance saves fill missing intake transport distances or delivery snapshots
without changing non-null recorded values. Warnings report how many were filled
and how many were left unchanged because of submitted lineage, concurrent writes
or changed references. A default supplier change may fill from the promoted
location's pairs; deletion's default promotion performs no fill. Existing
transport legs remain frozen. Delivery effective distance remains the override
when present, otherwise the recorded snapshot.

### Customer delete preview

Dry-run customer deletion returns data plus
`cascade: { orders: [{ id, code }], cascadeFingerprint }` and optional warnings.
The warning lists up to five order codes, then the remaining count. Review this
preview before deleting. REST accepts the optional cascadeFingerprint query
parameter; MCP accepts the argument. It hashes the sorted ids of orders to be
deleted, including the empty set, and excludes locations.

If the order set changes, a supplied fingerprint returns 409 cascade_changed at
/cascadeFingerprint with a fresh preview when that preview succeeds. The
customer version does not change when an order is added: If-Match checks the
customer first, and the fingerprint checks its cascade after locks are held.
Omitting the fingerprint accepts the current cascade. A keyed replay returns
the stored result before either check. Deletion retires documents and records
Activity for each removed order, location and customer in the same transaction.

## Formulations

Formulations use revision 2 with `description`, `archivedAt` and ordered `lines`.
Reads need `formulations:read`: REST list/detail and MCP `find_formulations`.
Lists hide archived rows by default. `archived=true` (MCP `archived: true`)
returns only archived rows, including exact code searches. Cursors bind that
filter; a mismatched cursor returns 400. Detail reads still return archived rows.

| REST method and path | MCP tool | Scope |
|---|---|---|
| POST `/formulations` | `create_formulation` | `formulations:write` |
| PATCH `/formulations/{id}` | `update_formulation` | `formulations:write` |
| DELETE `/formulations/{id}` | `delete_formulation` | `formulations:delete` |
| POST `/formulations/{id}/archive` | `archive_formulation` | `formulations:write` |
| POST `/formulations/{id}/restore` | `restore_formulation` | `formulations:write` |

Archive keeps existing references and reserves codes. New references and edits
of archived formulations return 404 at `/formulationId`; archived PATCH checks
this before stale versions. Repeated transitions with a current version return
409 at `/formulationId`. Restore before editing or adding a new reference.
Products, bins and orders (including archived references) block deletion with
409 at `/formulationId` and reference codes in metadata. Used line removal is
409 at `/lines`. Unknown or newly referenced archived types return 404; retained
archived types remain allowed. Type refusals point at `/lines/{index}/feedstockTypeId`;
non-blend types return 422. Add missing types in the app first.

Ratios are guidance only, from 0 to 1 in exact integer millionths (six decimals):
`0.000001` passes, `0.0000001` fails. Known shares may sum to exactly 1, never
more; sum refusals point at `/biocharRatio`. PATCH omission keeps, null clears,
zero stays zero; supplied `lines` replace the full list. Unknown fields and
invalid ratios return 422. REST pointers appear in `errors`; MCP uses `issues`.
