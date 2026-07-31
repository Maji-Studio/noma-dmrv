"use server";

import { withAutoCode } from "@/data-access/code-generator";
import { hasCertifierCredentials } from "@/data-access/certifier-credentials";
import {
  archiveFeedstockType,
  createFeedstockType,
  deleteFeedstockType,
  importIsometricFeedstockType,
  listFeedstockTypes,
  unarchiveFeedstockType,
  updateFeedstockType,
} from "@/data-access/feedstock-types";
import { feedstockTypes, type FeedstockType } from "@/db/schema";
import { requireOrgRole } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import {
  getIsometricClientForOrg,
  listFeedstockTypes as listIsometricFeedstockTypes,
} from "@/lib/isometric";
import {
  createFeedstockTypeSchema,
  deleteFeedstockTypeSchema,
  importIsometricFeedstockTypeSchema,
  updateFeedstockTypeSchema,
} from "@/schemas/feedstock-types";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

const FEEDSTOCK_TYPE_CODE_PREFIX = "FT";

export async function listFeedstockTypesFn(): Promise<
  ActionResult<FeedstockType[]>
> {
  return withAction((ctx) => listFeedstockTypes(ctx));
}

export async function createFeedstockTypeFn(
  input: unknown,
): Promise<ActionResult<FeedstockType>> {
  return withAction(async (ctx) => {
    const data = createFeedstockTypeSchema.parse(input);
    return withAutoCode(
      ctx,
      FEEDSTOCK_TYPE_CODE_PREFIX,
      feedstockTypes,
      feedstockTypes.code,
      undefined,
      (code) => createFeedstockType(ctx, { ...data, code }),
    );
  });
}

export async function updateFeedstockTypeFn(
  input: unknown,
): Promise<ActionResult<FeedstockType>> {
  return withAction((ctx) =>
    updateFeedstockType(ctx, updateFeedstockTypeSchema.parse(input)),
  );
}

export async function archiveFeedstockTypeFn(
  input: unknown,
): Promise<ActionResult<FeedstockType>> {
  return withAction((ctx) => {
    const { feedstockTypeId } = deleteFeedstockTypeSchema.parse(input);
    return archiveFeedstockType(ctx, feedstockTypeId);
  });
}

export async function unarchiveFeedstockTypeFn(
  input: unknown,
): Promise<ActionResult<FeedstockType>> {
  return withAction((ctx) => {
    const { feedstockTypeId } = deleteFeedstockTypeSchema.parse(input);
    return unarchiveFeedstockType(ctx, feedstockTypeId);
  });
}

export async function deleteFeedstockTypeFn(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return withAction((ctx) => {
    const { feedstockTypeId } = deleteFeedstockTypeSchema.parse(input);
    return deleteFeedstockType(ctx, feedstockTypeId);
  });
}

export async function importIsometricFeedstockTypeFn(
  input: unknown,
): Promise<ActionResult<FeedstockType>> {
  return withAction(async (ctx) => {
    requireOrgRole(ctx, "admin");
    const data = importIsometricFeedstockTypeSchema.parse(input);
    if (!(await hasCertifierCredentials(ctx, "isometric"))) {
      throw new SafeError(
        "Connect this Organization to Isometric before importing feedstock types.",
      );
    }
    const client = await getIsometricClientForOrg(ctx.organizationId);
    const catalogue = await listIsometricFeedstockTypes(client);
    const entry = catalogue.find(
      (candidate) => candidate.id === data.isometricFeedstockTypeId,
    );
    if (!entry) {
      throw new SafeError("That Isometric feedstock type is no longer available.");
    }
    return withAutoCode(
      ctx,
      FEEDSTOCK_TYPE_CODE_PREFIX,
      feedstockTypes,
      feedstockTypes.code,
      entry.supplier_reference_id,
      (code) => importIsometricFeedstockType(ctx, entry, data.category, code),
    );
  });
}
