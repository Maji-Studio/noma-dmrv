import { z } from "zod";
import { feedstockCategories } from "@/schemas/feedstock-types";
import { lookupFields, lookupInstants, lookupVersion, type LookupRepresentationInput } from "./lookup-fields";

export const feedstockTypeRepresentationSchema = z.object({
  ...lookupFields,
  version: lookupVersion,
  category: z.enum(feedstockCategories).describe("Feedstock classification category."),
  usage: z.enum(["pyrolysis", "blend"]).describe("Material use: pyrolysis feedstock or blend ingredient."),
});
export type FeedstockTypeRepresentation = z.infer<typeof feedstockTypeRepresentationSchema>;
export type FeedstockTypeRepresentationInput = Omit<LookupRepresentationInput<FeedstockTypeRepresentation>, "category"> & { category: string };

export function representFeedstockType(row: FeedstockTypeRepresentationInput): FeedstockTypeRepresentation {
  return feedstockTypeRepresentationSchema.parse({ ...row, ...lookupInstants(row) });
}
