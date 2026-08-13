import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { applications } from "@/db/schema/application";
import { certifierProjects } from "@/db/schema/certification";
import {
  certifierStorageLocations,
  type CertifierStorageLocation,
} from "@/db/schema/certifier-storage-locations";
import { deliveries, orders } from "@/db/schema/logistics";
import { customerLocations } from "@/db/schema/parties";
import type { OrgContext } from "@/lib/auth/server";
import type { CreateStorageLocationRequest } from "@/lib/isometric/storage-locations";
import { assertSameOrg, requireOrgScope } from "./utils";

type CertifierProvider = CertifierStorageLocation["provider"];
const DEFAULT_PROVIDER: CertifierProvider = "isometric";

export interface StorageLocationRegistryInput {
  applicationId: string;
  customerLocationId: string | null;
  certifierProjectId: string | null;
  externalProjectId: string | null;
  name: string | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Resolve an application's canonical reusable site through
 * application → delivery → order/delivery destination and its facility project.
 * Every joined branch is independently constrained to the active organization.
 */
export async function getStorageLocationRegistryInput(
  ctx: OrgContext,
  applicationId: string,
  provider: CertifierProvider = DEFAULT_PROVIDER,
): Promise<StorageLocationRegistryInput | null> {
  requireOrgScope(ctx);
  const [row] = await db
    .select({
      applicationId: applications.id,
      customerLocationId: customerLocations.id,
      certifierProjectId: certifierProjects.id,
      externalProjectId: certifierProjects.externalProjectId,
      name: customerLocations.name,
      latitude: customerLocations.gpsLatitude,
      longitude: customerLocations.gpsLongitude,
    })
    .from(applications)
    .innerJoin(
      deliveries,
      and(
        eq(applications.deliveryId, deliveries.id),
        eq(deliveries.organizationId, ctx.organizationId),
      ),
    )
    .innerJoin(
      orders,
      and(
        eq(deliveries.orderId, orders.id),
        eq(orders.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(
      customerLocations,
      and(
        eq(
          customerLocations.id,
          // Delivery destination overrides the order destination. Keeping the
          // coalesce inside this org-scoped join also fails closed if an
          // inconsistent row points at another organization's location.
          sql`coalesce(${deliveries.customerLocationId}, ${orders.customerLocationId})`,
        ),
        eq(customerLocations.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(
      certifierProjects,
      and(
        eq(certifierProjects.facilityId, deliveries.facilityId),
        eq(certifierProjects.provider, provider),
        eq(certifierProjects.organizationId, ctx.organizationId),
      ),
    )
    .where(
      and(
        eq(applications.id, applicationId),
        eq(applications.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function getStorageLocationRegistration(
  ctx: OrgContext,
  customerLocationId: string,
  provider: CertifierProvider = DEFAULT_PROVIDER,
): Promise<CertifierStorageLocation | null> {
  requireOrgScope(ctx);
  const [row] = await db
    .select()
    .from(certifierStorageLocations)
    .where(
      and(
        eq(certifierStorageLocations.organizationId, ctx.organizationId),
        eq(certifierStorageLocations.provider, provider),
        eq(certifierStorageLocations.customerLocationId, customerLocationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface PersistStorageLocationRegistrationInput {
  customerLocationId: string;
  certifierProjectId: string;
  externalProjectId: string;
  externalStorageLocationId: string;
  supplierReference: string;
  submittedPayload: CreateStorageLocationRequest;
  payloadHash: string;
  provider?: CertifierProvider;
}

/**
 * First writer fixes the external identity and submitted snapshot permanently.
 * Concurrent losers read and return that winner without overwriting it.
 */
export async function persistStorageLocationRegistration(
  ctx: OrgContext,
  input: PersistStorageLocationRegistrationInput,
): Promise<CertifierStorageLocation> {
  requireOrgScope(ctx);
  await Promise.all([
    assertSameOrg(ctx, customerLocations, input.customerLocationId),
    assertSameOrg(ctx, certifierProjects, input.certifierProjectId),
  ]);
  if (
    input.submittedPayload.project_id !== input.externalProjectId ||
    input.submittedPayload.supplier_reference_id !== input.supplierReference
  ) {
    throw new Error(
      "Storage Location registration identity does not match its submitted payload",
    );
  }
  const provider = input.provider ?? DEFAULT_PROVIDER;
  const [inserted] = await db
    .insert(certifierStorageLocations)
    .values({
      organizationId: ctx.organizationId,
      provider,
      customerLocationId: input.customerLocationId,
      certifierProjectId: input.certifierProjectId,
      externalProjectId: input.externalProjectId,
      externalStorageLocationId: input.externalStorageLocationId,
      supplierReference: input.supplierReference,
      submittedPayload: input.submittedPayload,
      payloadHash: input.payloadHash,
    })
    .onConflictDoNothing({
      target: [
        certifierStorageLocations.provider,
        certifierStorageLocations.customerLocationId,
      ],
    })
    .returning();
  if (inserted) return inserted;

  const winner = await getStorageLocationRegistration(
    ctx,
    input.customerLocationId,
    provider,
  );
  if (!winner) {
    throw new Error(
      `Storage Location registration race for customer location ${input.customerLocationId} produced no winner`,
    );
  }
  return winner;
}

export async function setStorageLocationDrift(
  ctx: OrgContext,
  registrationId: string,
  input:
    | { status: "in_sync" }
    | { status: "drifted"; details: Record<string, unknown> },
): Promise<void> {
  requireOrgScope(ctx);
  await db
    .update(certifierStorageLocations)
    .set(
      input.status === "drifted"
        ? {
            driftStatus: "drifted",
            driftDetails: input.details,
            driftDetectedAt: new Date(),
            updatedAt: new Date(),
          }
        : {
            driftStatus: "in_sync",
            driftDetails: null,
            driftDetectedAt: null,
            updatedAt: new Date(),
          },
    )
    .where(
      and(
        eq(certifierStorageLocations.id, registrationId),
        eq(certifierStorageLocations.organizationId, ctx.organizationId),
      ),
    );
}
