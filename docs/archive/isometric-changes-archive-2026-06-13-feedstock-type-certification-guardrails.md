# 2026-06-13 Isometric Changes Archive: Feedstock Type Certification Guardrails

## 2026-06-13 (feedstock type certification guardrails)

- Replaced the feedstock-type quick-add tab strip with selector cards for
  the local General form and the read-only Isometric catalogue, making the
  certification boundary explicit before users create a local feedstock type.
- Added searchable selection of Isometric feedstock types by name, Isometric
  ID, or `supplier_reference_id`; choosing one prefills the local type name
  and stores the selected Isometric ID in the existing registry reference field.
- Locked parent-constrained feedstock type usage in quick-add flows and locked
  the feedstock type when creating a bin from a feedstock allocation, reducing
  the chance that a bin is assigned to a mismatched feedstock.
