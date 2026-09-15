import { env } from "@/config/env";
import {
  getCertifierProjectByFacility,
  listFacilitiesLinkedToExternal,
  type CertifierProjectRow,
} from "@/data-access/certification";
import { requireOrgFacility } from "@/data-access/utils";
import type { OrgContext } from "@/lib/auth/server";
import { ISOMETRIC_PROVIDER } from "@/fn/certification/shared";
import { z } from "zod";

const facilityIdSchema = z.string().uuid("Choose a valid facility.");

export interface FacilityCertifierSummary {
  mapping: CertifierProjectRow | null;
  linkedFacilityCount: number;
  isProduction: boolean;
  viewerCanManage: boolean;
}

export async function readFacilityCertifierSummary(
  ctx: OrgContext,
  input: unknown,
): Promise<FacilityCertifierSummary> {
  const facilityId = facilityIdSchema.parse(input);
  await requireOrgFacility(ctx, facilityId);
  const mapping = await getCertifierProjectByFacility(
    ctx,
    facilityId,
    ISOMETRIC_PROVIDER,
  );
  const linkedFacilities = mapping
    ? await listFacilitiesLinkedToExternal(
        ctx,
        ISOMETRIC_PROVIDER,
        mapping.externalProjectId,
      )
    : [];
  return {
    mapping,
    linkedFacilityCount: linkedFacilities.length,
    isProduction: env.ISOMETRIC_ENVIRONMENT === "production",
    viewerCanManage:
      ctx.isPlatformAdmin ||
      ctx.orgRole === "owner" ||
      ctx.orgRole === "admin",
  };
}
