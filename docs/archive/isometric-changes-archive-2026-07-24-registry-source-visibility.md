# Registry Source Visibility — 2026-07-24

Certification Settings now exposes one organization-wide Isometric Source
visibility policy to organization Owners/Admins and Platform Admins. It defaults
to private and applies to every new Source created through the centralized
mirror flow, including generated Removal evidence-ledger PDFs. Per-document
visibility controls and the remote visibility PATCH action were removed, so
callers cannot override the persisted policy.

Policy changes are forward-only: noma does not bulk-rewrite existing Isometric
Sources, and reconciliation continues to preserve the registry-of-record
visibility for Sources that already exist. The Removal Supporting sources panel
also previews PDFs through the authenticated document route, identifies legacy
URL-only rows as lacking managed file bytes, and clarifies that local unlinking
leaves the Isometric Source and audit history intact.
