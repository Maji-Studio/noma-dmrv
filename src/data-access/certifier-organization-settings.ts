import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { certifierOrganizationSettings } from "@/db/schema/certification";
import { requireOrgRole, type OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";

type CertifierProvider =
  (typeof certifierOrganizationSettings.$inferSelect)["provider"];

export type RegistrySourceVisibility =
  (typeof certifierOrganizationSettings.$inferSelect)["sourceVisibility"];

export const DEFAULT_REGISTRY_SOURCE_VISIBILITY: RegistrySourceVisibility =
  "private";

export async function getRegistrySourceVisibility(
  ctx: OrgContext,
  provider: CertifierProvider,
): Promise<RegistrySourceVisibility> {
  requireOrgScope(ctx);
  const [row] = await db
    .select({
      sourceVisibility: certifierOrganizationSettings.sourceVisibility,
    })
    .from(certifierOrganizationSettings)
    .where(
      and(
        eq(certifierOrganizationSettings.organizationId, ctx.organizationId),
        eq(certifierOrganizationSettings.provider, provider),
      ),
    )
    .limit(1);

  return row?.sourceVisibility ?? DEFAULT_REGISTRY_SOURCE_VISIBILITY;
}

export async function upsertRegistrySourceVisibility(
  ctx: OrgContext,
  input: {
    provider: CertifierProvider;
    sourceVisibility: RegistrySourceVisibility;
  },
): Promise<RegistrySourceVisibility> {
  requireOrgScope(ctx);
  requireOrgRole(ctx, "admin");
  const [row] = await db
    .insert(certifierOrganizationSettings)
    .values({
      organizationId: ctx.organizationId,
      provider: input.provider,
      sourceVisibility: input.sourceVisibility,
    })
    .onConflictDoUpdate({
      target: [
        certifierOrganizationSettings.organizationId,
        certifierOrganizationSettings.provider,
      ],
      set: {
        sourceVisibility: input.sourceVisibility,
        updatedAt: new Date(),
      },
    })
    .returning({
      sourceVisibility: certifierOrganizationSettings.sourceVisibility,
    });

  if (!row) {
    throw new Error("Registry Source visibility setting was not saved.");
  }
  return row.sourceVisibility;
}
