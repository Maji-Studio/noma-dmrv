import { expect, it } from "vitest";
import type { OrgRole } from "@/lib/auth/server";
import { API_DOCUMENT_OWNERS, allowsApiDocumentType, canAccessOwnerDocuments } from "./api-owners";

it("publishes exactly the Phase 6a owner and type table", () => {
  expect(Object.keys(API_DOCUMENT_OWNERS)).toEqual(["feedstock", "delivery", "lab_sample"]);
  expect(API_DOCUMENT_OWNERS.feedstock.documentTypes).toEqual(["bill_of_lading", "weighbridge_ticket", "other_transport_evidence"]);
  expect(API_DOCUMENT_OWNERS.delivery.documentTypes).toEqual(["bill_of_lading", "weighbridge_ticket", "other_transport_evidence", "delivery_receipt", "photo"]);
  expect(API_DOCUMENT_OWNERS.lab_sample).toEqual({ entityType: "sample", path: "lab-samples", documentTypes: ["lab_report"], readScope: "lab-samples:read", writeScope: "lab-samples:write" });
  expect(allowsApiDocumentType("feedstock", "lab_report")).toBe(false);
  expect(allowsApiDocumentType("delivery", "photo")).toBe(true);
});

it.each(Object.entries(API_DOCUMENT_OWNERS))("uses %s owner scopes without implying read or write", (ownerType, owner) => {
  expect(canAccessOwnerDocuments({ orgRole: "admin", scopes: [owner.readScope] }, ownerType, "read")).toBe(true);
  expect(canAccessOwnerDocuments({ orgRole: "admin", scopes: [owner.readScope] }, ownerType, "write")).toBe(false);
  expect(canAccessOwnerDocuments({ orgRole: "admin", scopes: [owner.writeScope] }, ownerType, "write")).toBe(true);
  expect(canAccessOwnerDocuments({ orgRole: "admin", scopes: [owner.writeScope] }, ownerType, "read")).toBe(false);
  expect(canAccessOwnerDocuments({ orgRole: "admin", scopes: ["facilities:read"] }, ownerType, "read")).toBe(false);
  expect(canAccessOwnerDocuments({ orgRole: "admin", scopes: [] }, ownerType, "write")).toBe(false);
  expect(canAccessOwnerDocuments({ orgRole: "admin", scopes: [owner.writeScope] }, "__proto__", "write")).toBe(false);
});

it.each(Object.entries(API_DOCUMENT_OWNERS))("enforces the API role floor for %s", (ownerType, owner) => {
  for (const orgRole of ["owner", "admin", "member", null] satisfies (OrgRole | null)[]) {
    const context = { orgRole, scopes: [owner.readScope, owner.writeScope] };
    const allowed = orgRole === "owner" || orgRole === "admin";
    expect(canAccessOwnerDocuments(context, ownerType, "read")).toBe(allowed);
    expect(canAccessOwnerDocuments(context, ownerType, "write")).toBe(allowed);
  }
});
