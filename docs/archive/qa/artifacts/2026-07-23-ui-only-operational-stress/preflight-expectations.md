# 2026-07-23 UI-only operational stress test — preflight expectations

This is a read-only expected-behavior reference prepared before visible staging interaction. It is not execution evidence, and no item below is a pass, failure, defect, or staging observation until reproduced through the authorized visible Computer Use transport.

## Canonical chain

Feedstock (+ Reactor) → Production Run → Biochar Product → Order → Delivery → Application. Credit batches contain completed production runs; applications are derived downstream. A batch is one facility, one feedstock, and a production window of at most one month.

## Roles expected from documentation

| Role | Ordinary operational CRUD/documents/inventory | Members/settings | Certification submit | Platform-only configuration |
| --- | --- | --- | --- | --- |
| Platform Admin | Allowed in any active organization | Allowed | Allowed | Organization creation, registry credentials, facility mapping/config |
| Owner | Allowed | Allowed; last owner protected | Allowed | Not expected |
| Admin | Allowed | Allowed | Allowed | Not expected |
| Member | Allowed | Not expected | Not expected | Not expected |

If no additional authorized accounts are visibly available, multi-role execution remains blocked; invitations must not be sent.

## Facility scope and intentional organization sharing

- Facility, reactor, storage, intake, production run, biochar product, order, and delivery records are facility-scoped.
- Suppliers, customers, their locations, and feedstock types are organization-wide by design. Shared visibility alone is not a facility-isolation defect.
- A security/scoping defect requires visible disclosure or selection of an inactive facility's facility-scoped record, or an organization-wide record silently carrying incorrect facility-relative data such as distance.

## Inventory equations

- Feedstock ending stock = complete-intake dry kg − non-cancelled production consumption + signed feedstock movements.
- Biochar ending stock = non-cancelled run output − biochar-equivalent product allocation + signed biochar movements.
- Product ending stock = product wet mass − delivered delivery wet mass + signed product movements. Upcoming deliveries do not draw stock.
- Bin movements are append-only; corrections use compensating movements. Stock-take movement = counted stock − current derived stock.
- All withdrawals are expected to block before producing a negative balance.

## Lifecycle/dependency expectations

| Entity | Principal expected protection |
| --- | --- |
| Facility | Reversible archive cascades facility-scoped visibility; populated/submitted impact is warned, not necessarily blocked |
| Reactor | Delete blocked by production runs |
| Storage | Type/formulation compatibility enforced; delete blocked by dependent stock/records |
| Supplier | Delete blocked by intakes |
| Feedstock intake | Update/delete certification-locked; delete blocked by run consumption and otherwise returns stock |
| Customer | Delete blocked by orders and remaining locations |
| Production run | Lifecycle rules enforced; complete/failed need end and consumption; delete blocked by products/batches; optimistic concurrency expected |
| Biochar product | Requires completed run and sufficient compatible stock; delete blocked by orders/deliveries |
| Order | Same-facility product and same-org customer; delete blocked by deliveries |
| Delivery | Only delivered positive mass draws stock; delete blocked by applications |
| Application | Delivery must be delivered; date not before delivery; cumulative mass cannot exceed delivered mass |
| Documents | Parent must exist in active org; invalid uploads fail closed; mirrored registry sources block deletion |

## Upload expectations

- All current user-uploaded document types have a 10 MB server cap.
- Upload sequence is request → pending private row → visible file transfer → authoritative confirmation.
- A rejected upload should delete the object and mark the row failed; it must not produce a false attached-document record.
- Duplicate filenames are allowed because storage keys are unique and do not use the original filename.
- Uploading transport evidence and setting distance source to `document` are independent requirements.

## High-value staging probes

1. Regress the prior facility-context and deep-link findings without treating intentional organization-wide parties as leakage.
2. Verify overdraw and negative-stock guards, including partial/exact/full transfers and upstream mass reduction after downstream allocation.
3. Verify whether formulated-product creation reduces compatible ingredient-bin stock.
4. Verify whether a visible bin-to-bin transfer workflow exists; absence is untested product surface, not inferred from source.
5. Verify feedstock-type edit/delete availability and customer-location/storage dependency error quality.
6. Verify upload on one entity and, only if a valid small upload fails, reproduce once on a second entity type and stop.
7. Regress logout across two tabs, stale selectors, storage-list refresh, application/feedstock readiness contradictions, and responsive traceability without automatically reopening historical findings.
8. Confirm quick-added prerequisites become selectable without refresh.

## Required adversarial boundaries

- Empty/whitespace and trimmed names; duplicate identifiers; invalid/half GPS; very long and Unicode text.
- Zero, negative, nonnumeric, excessive, and extreme masses; moisture/percent outside 0–100; dry mass above wet/input; formulation ratio above 100%.
- Start/end and delivery/application date order; facility-timezone midnight edges; refresh/reopen date persistence.
- Repeated ordinary save clicks; back/forward; refresh mid-form; two-tab stale draft sequence.
- Inactive-facility dependency attempts and visible deep-link behavior after switching context.

## Evidence boundary

Only visible Computer Use observations may populate the final findings, matrices, screenshots, inventories, or verdict. Source references may support expected behavior or confirm root cause after visible reproduction; they cannot substitute for staging execution.
