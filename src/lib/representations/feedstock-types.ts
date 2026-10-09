import { z } from "zod";
import { lookupFields, lookupInstants, lookupVersion, type LookupRepresentationInput } from "./lookup-fields";

export const feedstockTypeRepresentationSchema = z.object({
  ...lookupFields,
  version: lookupVersion,
  category: z.string().describe("Feedstock classification category, plain text."),
  usage: z.enum(["pyrolysis", "blend"]).describe("Material use: pyrolysis feedstock or blend ingredient."),
});
export type FeedstockTypeRepresentation = z.infer<typeof feedstockTypeRepresentationSchema>;
export type FeedstockTypeRepresentationInput = LookupRepresentationInput<FeedstockTypeRepresentation>;

export function representFeedstockType(row: FeedstockTypeRepresentationInput): FeedstockTypeRepresentation {
  return feedstockTypeRepresentationSchema.parse({ ...row, ...lookupInstants(row) });
}
