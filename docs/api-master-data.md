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
locations currently omit it.

Archive keeps existing references. Archived suppliers cannot be newly referenced
by intakes; archived customers cannot be newly referenced by orders. A changed
destination on the same archived customer is also refused. Kept references pass,
including deliveries and applications on an existing order when its customer or
formulation is archived. PATCH of an archived party returns 404 at `/supplierId`
or `/customerId` before stale-version and representation-revision checks.
Existing location add/update paths also refuse an archived parent; delete stays
allowed. Restore the parent before editing it or adding a new reference.

Supplier deletion is blocked by feedstock intakes, returning 409 at `/supplierId`.
Customer deletion is blocked by orders or registered storage sites on its
locations, returning 409 at `/customerId`. Blocker metadata identifies references.
An unused party, including an archived party, can be deleted together with its
locations and facility distance pairs. A blocked delete removes nothing.

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

