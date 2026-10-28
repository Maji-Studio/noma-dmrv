"use server";

import { z } from "zod";
import type { FeedstockTypeLinkLock } from "@/data-access/feedstock-type-link-lock";
import { withAutoCode } from "@/data-access/code-generator";
import { hasCertifierCredentials, resolveIsometricClient } from "@/data-access/certifier-credentials";
import {
  FEEDSTOCK_TYPE_MANAGE_ROLE,
  archiveFeedstockType,
  deleteFeedstockType,
  importIsometricFeedstockType,
  listFeedstockTypes,
  readFeedstockTypeLinkLock,
  unarchiveFeedstockType,
  updateFeedstockType,
} from "@/data-access/feedstock-types";
import { feedstockTypes, type FeedstockType } from "@/db/schema";
import { hasOrgRole, requireOrgRole } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import {
  listFeedstockTypes as listIsometricFeedstockTypes,
} from "@/lib/isometric";
import {
  createFeedstockTypeSchema,
  deleteFeedstockTypeSchema,
  importIsometricFeedstockTypeSchema,
  updateFeedstockTypeSchema,
} from "@/schemas/feedstock-types";
import type { ActionResult } from "@/types/actions";
import { createFeedstockType } from "@/lib/operations/feedstock-types";
import type { CreateIntentOptions } from "@/schemas/create-intent";
import { withCreate } from "./with-create";
import { withAction } from "./with-action";
import { getFeedstockTypeById } from "@/data-access/feedstock-types";
import { uuidSchema } from "@/schemas/helpers";

const FEEDSTOCK_TYPE_CODE_PREFIX = "FT";
const feedstockTypeLinkLockSchema = z.object({ feedstockTypeId: uuidSchema() });

export async function getFeedstockTypeLinkLockFn(
  input: unknown,
): Promise<ActionResult<FeedstockTypeLinkLock>> {
  return withAction((ctx) => {
    const { feedstockTypeId } = feedstockTypeLinkLockSchema.parse(input);
    return readFeedstockTypeLinkLock(ctx, feedstockTypeId);
  });
}

export async function listFeedstockTypesFn(): Promise<
  ActionResult<FeedstockType[]>
> {
  return withAction((ctx) => listFeedstockTypes(ctx));
}

export async function createFeedstockTypeFn(
  input: unknown,
  options?: CreateIntentOptions,
): Promise<ActionResult<FeedstockType>> {
  return withCreate((_ctx, create) =>
    create(createFeedstockType, createFeedstockTypeSchema.parse(input)), options);
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
    const { feedstockTypeId, expectedVersion } = deleteFeedstockTypeSchema.parse(input);
    return archiveFeedstockType(ctx, feedstockTypeId, expectedVersion);
  });
}

export async function unarchiveFeedstockTypeFn(
  input: unknown,
): Promise<ActionResult<FeedstockType>> {
  return withAction((ctx) => {
    const { feedstockTypeId, expectedVersion } = deleteFeedstockTypeSchema.parse(input);
    return unarchiveFeedstockType(ctx, feedstockTypeId, expectedVersion);
  });
}

export async function deleteFeedstockTypeFn(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return withAction((ctx) => {
    const { feedstockTypeId, expectedVersion } = deleteFeedstockTypeSchema.parse(input);
    return deleteFeedstockType(ctx, feedstockTypeId, expectedVersion);
  });
}

export async function importIsometricFeedstockTypeFn(
  input: unknown,
): Promise<ActionResult<FeedstockType>> {
  return withAction(async (ctx) => {
    requireOrgRole(ctx, FEEDSTOCK_TYPE_MANAGE_ROLE);
    const data = importIsometricFeedstockTypeSchema.parse(input);
    if (!(await hasCertifierCredentials(ctx, "isometric"))) {
      throw new SafeError(
        "Connect this Organization to Isometric before importing feedstock types.",
      );
    }
    const client = await resolveIsometricClient(ctx);
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

export async function getFeedstockTypeByIdFn(id: string) {
  return withAction((ctx) => getFeedstockTypeById(ctx, uuidSchema().parse(id)));
}

/** UI affordance only; writes still enforce the role in data access. */
export async function canManageFeedstockTypesFn() {
  return withAction(async (ctx) => hasOrgRole(ctx, FEEDSTOCK_TYPE_MANAGE_ROLE));
}
