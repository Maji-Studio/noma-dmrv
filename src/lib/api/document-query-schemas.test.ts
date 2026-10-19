import { expect, it } from "vitest";
import { documentListSchema } from "./query-schemas";
import { lookupIdentifier } from "./lookup-query";

it("defaults to uploaded and limits types to the owner's API evidence", () => {
  expect(documentListSchema("feedstock").parse({})).toMatchObject({ uploadStatus: "uploaded" });
  expect(documentListSchema("delivery").parse({ documentType: "photo", uploadStatus: "all" })).toMatchObject({ documentType: "photo", uploadStatus: "all" });
  for (const uploadStatus of ["pending", "failed", "uploaded", "all"]) {
    expect(documentListSchema("lab_sample").safeParse({ uploadStatus }).success).toBe(true);
  }
  for (const input of [{ documentType: "photo" }, { documentType: "transport_evidence_ledger" }, { include: "all" }, { uploadStatus: "unknown" }]) {
    expect(documentListSchema("feedstock").safeParse(input).success).toBe(false);
  }
  expect(documentListSchema("lab_sample").safeParse({ documentType: "bill_of_lading" }).success).toBe(false);
});

it("canonicalizes owner UUIDs without changing exact codes", () => {
  expect(lookupIdentifier("ABCDEFAB-1234-4567-89AB-ABCDEFABCDEF")).toEqual({ id: "abcdefab-1234-4567-89ab-abcdefabcdef" });
  expect(lookupIdentifier("FS-EXACT")).toEqual({ code: "FS-EXACT" });
});
