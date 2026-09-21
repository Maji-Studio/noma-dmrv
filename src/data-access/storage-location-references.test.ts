/**
 * The bin reference list is shared (#767 review).
 *
 * `deleteStorageLocation` and the stocked-bin identity guard once kept separate
 * copies of "every table that points at a bin" and drifted: only the identity
 * guard saw `output_stock_allocations`. These tests pin the shared list so a
 * table added for one guard cannot go missing from the other.
 */

import { describe, expect, it } from "vitest";
import type { OrgContext } from "@/lib/auth/server";
import {
  countStorageLocationReferences,
  hasStorageLocationReferences,
  storageLocationBlockers,
} from "./storage-location-references";

const CTX: OrgContext = {
  userId: "user-1",
  organizationId: "org-1",
  orgRole: "owner",
  isPlatformAdmin: false,
};

const BIN_ID = "bin-1";

/** A Drizzle reader stub that answers every counted chain with `value`. */
function readerReturning(value: number) {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ value }]),
      }),
    }),
  } as never;
}

describe("countStorageLocationReferences", () => {
  it("covers every table that points at a bin, output allocations included", async () => {
    const references = await countStorageLocationReferences(
      CTX,
      readerReturning(1),
      BIN_ID,
    );

    expect(storageLocationBlockers(references)).toEqual([
      "feedstock batches",
      "production runs using it as a feedstock bin",
      "production runs using it as a biochar bin",
      "biochar products stored in it",
      "biochar products sourced from it",
      "product source allocations drawing from it",
      "deliveries drawing from it",
      "storage inventory records",
      "reconciliation or movement history",
      "output bin layer records",
    ]);
  });

  it("reports an untouched bin as free of references", async () => {
    const references = await countStorageLocationReferences(
      CTX,
      readerReturning(0),
      BIN_ID,
    );

    expect(hasStorageLocationReferences(references)).toBe(false);
    expect(storageLocationBlockers(references)).toEqual([]);
  });

  it("refuses an unscoped context", async () => {
    await expect(
      countStorageLocationReferences(
        { ...CTX, organizationId: "" },
        readerReturning(0),
        BIN_ID,
      ),
    ).rejects.toThrow("Unauthorized");
  });
});
