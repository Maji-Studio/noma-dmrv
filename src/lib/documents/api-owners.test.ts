import { expect, it } from "vitest";
import type { OrgRole } from "@/lib/auth/server";
import { API_DOCUMENT_OWNERS, allowsApiDocumentType, canAccessOwnerDocuments } from "./api-owners";

it("publishes the evidence owner and type table including application photos and PDFs", () => {
  expect(Object.keys(API_DOCUMENT_OWNERS)).toEqual(["feedstock", "delivery", "lab_sample", "application"]);
  expect(API_DOCUMENT_OWNERS.feedstock.documentTypes).toEqual(["bill_of_lading", "weighbridge_ticket", "other_transport_evidence"]);
  expect(API_DOCUMENT_OWNERS.delivery.documentTypes).toEqual(["bill_of_lading", "weighbridge_ticket", "other_transport_evidence", "delivery_receipt", "photo"]);
  expect(API_DOCUMENT_OWNERS.lab_sample).toEqual({ entityType: "sample", path: "lab-samples", documentTypes: ["lab_report"], readScope: "lab-samples:read", writeScope: "lab-samples:write" });
  expect(allowsApiDocumentType("feedstock", "lab_report")).toBe(false);
  expect(allowsApiDocumentType("delivery", "photo")).toBe(true);
  expect(API_DOCUMENT_OWNERS.application).toEqual({ entityType: "application", path: "applications", documentTypes: ["photo", "pdf"], readScope: "applications:read", writeScope: "applications:write" });
  for (const type of ["gis_boundary", "weighbridge_ticket", "affidavit"] as const) expect(allowsApiDocumentType("application", type)).toBe(false);
  expect(canAccessOwnerDocuments({ principal: { kind: "api-key" }, orgRole: "owner", scopes: ["deliveries:write"] }, "application", "write")).toBe(false);
});

it.each(Object.entries(API_DOCUMENT_OWNERS))("uses %s owner scopes without implying read or write", (ownerType, owner) => {
  expect(canAccessOwnerDocuments({ principal: { kind: "api-key" }, orgRole: "admin", scopes: [owner.readScope] }, ownerType, "read")).toBe(true);
  expect(canAccessOwnerDocuments({ principal: { kind: "api-key" }, orgRole: "admin", scopes: [owner.readScope] }, ownerType, "write")).toBe(false);
  expect(canAccessOwnerDocuments({ principal: { kind: "api-key" }, orgRole: "admin", scopes: [owner.writeScope] }, ownerType, "write")).toBe(true);
  expect(canAccessOwnerDocuments({ principal: { kind: "api-key" }, orgRole: "admin", scopes: [owner.writeScope] }, ownerType, "read")).toBe(false);
  expect(canAccessOwnerDocuments({ principal: { kind: "api-key" }, orgRole: "admin", scopes: ["facilities:read"] }, ownerType, "read")).toBe(false);
  expect(canAccessOwnerDocuments({ principal: { kind: "api-key" }, orgRole: "admin", scopes: [] }, ownerType, "write")).toBe(false);
  expect(canAccessOwnerDocuments({ principal: { kind: "api-key" }, orgRole: "admin", scopes: [owner.writeScope] }, "__proto__", "write")).toBe(false);
});

it.each(Object.entries(API_DOCUMENT_OWNERS))("enforces the API role floor for %s", (ownerType, owner) => {
  for (const orgRole of ["owner", "admin", "member", null] satisfies (OrgRole | null)[]) {
    const context = { principal: { kind: "api-key" as const }, orgRole, scopes: [owner.readScope, owner.writeScope] };
    const allowed = orgRole === "owner" || orgRole === "admin";
    expect(canAccessOwnerDocuments(context, ownerType, "read")).toBe(allowed);
    expect(canAccessOwnerDocuments(context, ownerType, "write")).toBe(allowed);
  }
});
