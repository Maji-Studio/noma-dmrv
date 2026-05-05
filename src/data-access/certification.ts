import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  certifierProjects,
  certificationSubmissions,
} from "@/db/schema/certification";
import { creditBatches } from "@/db/schema/credits";
import { facilities } from "@/db/schema/facilities";
import { SafeError } from "@/lib/errors";
import { requireAuth } from "./utils";

type CertifierProvider = (typeof certifierProjects.$inferSelect)["provider"];
export type CertifierProjectRow = typeof certifierProjects.$inferSelect;

export interface UpsertCertifierProjectInput {
  facilityId: string;
  provider: CertifierProvider;
  externalProjectId: string;
  protocolSlug?: string;
  protocolVersion?: string | null;
  defaultRemovalTemplateId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface LinkedFacilitySummary {
  facilityId: string;
  code: string;
  name: string;
}

export async function getCertifierProjectByFacility(
  userId: string,
  facilityId: string,
  provider: CertifierProvider = "isometric",
): Promise<CertifierProjectRow | null> {
  requireAuth(userId);
  const [row] = await db
    .select()
    .from(certifierProjects)
    .where(
      and(
        eq(certifierProjects.facilityId, facilityId),
        eq(certifierProjects.provider, provider),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listFacilitiesLinkedToExternal(
  userId: string,
  provider: CertifierProvider,
  externalProjectId: string,
): Promise<LinkedFacilitySummary[]> {
  requireAuth(userId);
  const rows = await db
    .select({
      facilityId: facilities.id,
      code: facilities.code,
      name: facilities.name,
    })
    .from(certifierProjects)
    .innerJoin(facilities, eq(certifierProjects.facilityId, facilities.id))
    .where(
      and(
        eq(certifierProjects.provider, provider),
        eq(certifierProjects.externalProjectId, externalProjectId),
      ),
    );
  return rows;
}

export async function upsertCertifierProject(
  userId: string,
  input: UpsertCertifierProjectInput,
): Promise<CertifierProjectRow> {
  requireAuth(userId);
  const values = {
    facilityId: input.facilityId,
    provider: input.provider,
    externalProjectId: input.externalProjectId,
    protocolSlug: input.protocolSlug ?? "biochar",
    protocolVersion: input.protocolVersion ?? null,
    defaultRemovalTemplateId: input.defaultRemovalTemplateId ?? null,
    metadata: input.metadata ?? null,
  };

  const [row] = await db
    .insert(certifierProjects)
    .values(values)
    .onConflictDoUpdate({
      target: [certifierProjects.facilityId, certifierProjects.provider],
      set: {
        externalProjectId: values.externalProjectId,
        protocolSlug: values.protocolSlug,
        protocolVersion: values.protocolVersion,
        defaultRemovalTemplateId: values.defaultRemovalTemplateId,
        metadata: values.metadata,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  return row;
}

export async function deleteCertifierProject(
  userId: string,
  facilityId: string,
  provider: CertifierProvider = "isometric",
): Promise<void> {
  requireAuth(userId);

  // Unlink guard: refuse if any credit batch from this facility has been
  // submitted to the certifier. Phase 3 will be the first writer; this guard
  // expands as additional submission types come online.
  const [blocking] = await db
    .select({ id: certificationSubmissions.id })
    .from(certificationSubmissions)
    .innerJoin(
      creditBatches,
      eq(certificationSubmissions.localEntityId, creditBatches.id),
    )
    .where(
      and(
        eq(certificationSubmissions.provider, provider),
        eq(certificationSubmissions.localEntityType, "creditBatch"),
        eq(creditBatches.facilityId, facilityId),
      ),
    )
    .limit(1);

  if (blocking) {
    throw new SafeError(
      "Cannot unlink: this facility has credit batch submissions on the certifier. Supersede or reject them first.",
    );
  }

  await db
    .delete(certifierProjects)
    .where(
      and(
        eq(certifierProjects.facilityId, facilityId),
        eq(certifierProjects.provider, provider),
      ),
    );
}
