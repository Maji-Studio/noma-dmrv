import { isPgUniqueViolation } from "@/db/errors";
import { SafeError } from "@/lib/errors";
import { CODE_CONFLICT_MESSAGES, withAutoCodes } from "@/data-access/code-generator";
import { createFeedstockTypeInTransaction } from "@/data-access/feedstock-types";
import { feedstockTypes, type FeedstockType } from "@/db/schema";
import { createFeedstockTypeSchema } from "@/schemas/feedstock-types";
import type { Operation } from "./runner";

const AUTO_CODE_COUNT = 1;
const REGISTRY_ID_CONSTRAINT = "feedstock_types_organization_id_isometric_id_unique";
const NAME_USAGE_CONSTRAINT = "feedstock_types_organization_id_name_usage_unique";

/** App-only operation for quick-add and the settings create (#1302). */
export const createFeedstockType: Operation<typeof createFeedstockTypeSchema, FeedstockType> = {
  id: "create_feedstock_type",
  input: createFeedstockTypeSchema,
  supportsDryRun: false,
  execute: async ({ ctx, tx }, input) => {
    try {
      return await withAutoCodes(ctx, tx, "FT", feedstockTypes, feedstockTypes.code, AUTO_CODE_COUNT,
        ([code], savepoint) => createFeedstockTypeInTransaction(ctx, savepoint, { ...input, code }), CODE_CONFLICT_MESSAGES.feedstockType);
    } catch (error) {
      if (isPgUniqueViolation(error, REGISTRY_ID_CONSTRAINT)) {
        throw new SafeError("This Isometric feedstock type already exists. Select the existing feedstock type.");
      }
      if (isPgUniqueViolation(error, NAME_USAGE_CONSTRAINT)) {
        throw new SafeError("A feedstock type with this name and usage already exists");
      }
      throw error;
    }
  },
};
