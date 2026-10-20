/**
 * "Adding stock" to an output bin: the create form of what fills it, a new
 * biochar product for a product bin or a new production run for a biochar
 * bin, opened with that bin already chosen.
 */
import { z } from "zod";
import { createIntentHref } from "@/lib/create-intent";

/** The list parameter naming the bin the new product or run goes into. */
export const ADD_STOCK_BIN_PARAM = "bin";

/** Where each kind of output bin gets its stock: products go into product bins, runs into biochar bins. */
const ADD_STOCK = {
  product: { path: "/biochar-products", binType: "product_bin" },
  biochar: { path: "/production-runs", binType: "biochar_bin" },
} as const;

export type AddStockLane = keyof typeof ADD_STOCK;

export function addStockHref(lane: AddStockLane, facilityId: string, storageLocationId: string): string {
  return createIntentHref(ADD_STOCK[lane].path, facilityId, { [ADD_STOCK_BIN_PARAM]: storageLocationId });
}

const binIdSchema = z.uuid();

/** The requested bin id when it is one, else null: a hand-edited link never reaches the bin lookup. */
export function addStockBinId(value: string | null | undefined): string | null {
  return binIdSchema.safeParse(value).success ? (value as string) : null;
}

interface AddStockBinCandidate {
  id: string;
  type: string;
  facilityId: string;
  formulationId: string | null;
  archivedAt: Date | string | null;
}

/**
 * The bin a create form may open with: the requested bin, read through the
 * org-scoped bin lookup, when it is the kind the form fills, in the form's
 * facility and not archived. Anything else opens the form with no bin chosen.
 */
export function resolveAddStockBin(
  bin: AddStockBinCandidate | null | undefined,
  lane: AddStockLane,
  facilityId: string | null | undefined,
): { storageLocationId: string; formulationId: string | null } | null {
  if (!bin || !facilityId || bin.type !== ADD_STOCK[lane].binType || bin.facilityId !== facilityId || bin.archivedAt) return null;
  return { storageLocationId: bin.id, formulationId: bin.formulationId };
}
