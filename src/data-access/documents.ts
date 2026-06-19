import { and, desc, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  applications,
  biocharProducts,
  certifierRemovals,
  creditBatches,
  deliveries,
  documents,
  facilities,
  feedstockDeliveries,
  feedstocks,
  incidentReports,
  orders,
  productionRuns,
  productionSamples,
  reactors,
  samples,
  transportLegs,
} from "@/db/schema";
import { SafeError } from "@/lib/errors";
import {
  DOCUMENT_ENTITY_TYPES,
  type DocumentEntityType,
} from "@/schemas/documents";
import { requireAuth } from "./utils";

/**
 * Hard cap on documents returned for a single entity. This is a guardrail
 * against unbounded scans — NOT pagination. Full pagination is tracked
 * separately (architecture audit, Phase 3).
 */
const MAX_DOCUMENTS_PER_ENTITY = 200;
const DELIVERY_TABLE_NAME = "deliveries";
const DELIVERY_ARCHIVED_AT_COLUMN = "archived_at";

let deliveryArchivedAtColumnAvailablePromise: Promise<boolean> | null = null;

export type DocumentRow = typeof documents.$inferSelect;
export type NewDocumentRow = typeof documents.$inferInsert;

const DOCUMENT_ENTITY_LABELS: Record<DocumentEntityType, string> = {
  sample: "Sample",
  delivery: "Delivery",
  production_run: "Production run",
  production_incident: "Production incident",
  production_sample: "Production sample",
  biochar_product: "Biochar product",
  feedstock: "Feedstock",
  feedstock_delivery: "Feedstock delivery",
  application: "Application",
  credit_batch: "Credit batch",
  facility: "Facility",
  reactor: "Reactor",
  order: "Order",
  transport_leg: "Transport leg",
};

function isDocumentEntityType(entityType: string): entityType is DocumentEntityType {
  return DOCUMENT_ENTITY_TYPES.includes(entityType as DocumentEntityType);
}

function entityMissingError(entityType: DocumentEntityType) {
  return new SafeError(
    `${DOCUMENT_ENTITY_LABELS[entityType]} not found or archived`
  );
}

async function hasDeliveryArchivedAtColumn(): Promise<boolean> {
  if (!deliveryArchivedAtColumnAvailablePromise) {
    deliveryArchivedAtColumnAvailablePromise = db
      .execute<{ column_name: string }>(sql`
        select column_name
        from information_schema.columns
        where table_schema = 'public'
          and table_name = ${DELIVERY_TABLE_NAME}
          and column_name = ${DELIVERY_ARCHIVED_AT_COLUMN}
      `)
      .then(({ rows }) => rows.length > 0);
  }

  return deliveryArchivedAtColumnAvailablePromise;
}

export async function assertCanManageDocumentEntity(
  userId: string,
  entityType: string,
  entityId: string
): Promise<void> {
  requireAuth(userId);

  if (!isDocumentEntityType(entityType)) {
    throw new SafeError("Unsupported document entity type");
  }

  switch (entityType) {
    case "sample": {
      const [row] = await db
        .select({ id: samples.id })
        .from(samples)
        .where(eq(samples.id, entityId));
      if (!row) throw entityMissingError(entityType);
      return;
    }
    case "delivery": {
      const conditions = [eq(deliveries.id, entityId)];
      if (await hasDeliveryArchivedAtColumn()) {
        conditions.push(isNull(deliveries.archivedAt));
      }
      const [row] = await db
        .select({ id: deliveries.id })
        .from(deliveries)
        .where(and(...conditions));
      if (!row) throw entityMissingError(entityType);
      return;
    }
    case "production_run": {
      const [row] = await db
        .select({ id: productionRuns.id })
        .from(productionRuns)
        .where(
          and(
            eq(productionRuns.id, entityId),
            isNull(productionRuns.archivedAt)
          )
        );
      if (!row) throw entityMissingError(entityType);
      return;
    }
    case "production_incident": {
      const [row] = await db
        .select({ id: incidentReports.id })
        .from(incidentReports)
        .where(eq(incidentReports.id, entityId));
      if (!row) throw entityMissingError(entityType);
      return;
    }
    case "production_sample": {
      const [row] = await db
        .select({ id: productionSamples.id })
        .from(productionSamples)
        .where(eq(productionSamples.id, entityId));
      if (!row) throw entityMissingError(entityType);
      return;
    }
    case "biochar_product": {
      const [row] = await db
        .select({ id: biocharProducts.id })
        .from(biocharProducts)
        .where(
          and(
            eq(biocharProducts.id, entityId),
            isNull(biocharProducts.archivedAt)
          )
        );
      if (!row) throw entityMissingError(entityType);
      return;
    }
    case "feedstock": {
      const [row] = await db
        .select({ id: feedstocks.id })
        .from(feedstocks)
        .where(and(eq(feedstocks.id, entityId), isNull(feedstocks.archivedAt)));
      if (!row) throw entityMissingError(entityType);
      return;
    }
    case "feedstock_delivery": {
      const [row] = await db
        .select({ id: feedstockDeliveries.id })
        .from(feedstockDeliveries)
        .where(
          and(
            eq(feedstockDeliveries.id, entityId),
            isNull(feedstockDeliveries.archivedAt)
          )
        );
      if (!row) throw entityMissingError(entityType);
      return;
    }
    case "application": {
      const [row] = await db
        .select({ id: applications.id })
        .from(applications)
        .where(eq(applications.id, entityId));
      if (!row) throw entityMissingError(entityType);
      return;
    }
    case "credit_batch": {
      const [row] = await db
        .select({ id: creditBatches.id })
        .from(creditBatches)
        .where(
          and(eq(creditBatches.id, entityId), isNull(creditBatches.archivedAt))
        );
      if (!row) throw entityMissingError(entityType);
      return;
    }
    case "facility": {
      const [row] = await db
        .select({ id: facilities.id })
        .from(facilities)
        .where(and(eq(facilities.id, entityId), isNull(facilities.archivedAt)));
      if (!row) throw entityMissingError(entityType);
      return;
    }
    case "reactor": {
      const [row] = await db
        .select({ id: reactors.id })
        .from(reactors)
        .where(and(eq(reactors.id, entityId), isNull(reactors.archivedAt)));
      if (!row) throw entityMissingError(entityType);
      return;
    }
    case "order": {
      const [row] = await db
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.id, entityId), isNull(orders.archivedAt)));
      if (!row) throw entityMissingError(entityType);
      return;
    }
    case "transport_leg": {
      const [row] = await db
        .select({ id: transportLegs.id })
        .from(transportLegs)
        .where(eq(transportLegs.id, entityId));
      if (!row) throw entityMissingError(entityType);
      return;
    }
  }
}

async function assertRemovalExistsForDocumentLookup(
  removalId: string
): Promise<void> {
  const [row] = await db
    .select({ id: certifierRemovals.id })
    .from(certifierRemovals)
    .where(eq(certifierRemovals.id, removalId))
    .limit(1);

  if (!row) {
    throw new SafeError("Removal not found");
  }
}

export async function listDocumentsForEntity(
  userId: string,
  entityType: string,
  entityId: string
): Promise<DocumentRow[]> {
  requireAuth(userId);
  await assertCanManageDocumentEntity(userId, entityType, entityId);
  return db
    .select()
    .from(documents)
    .where(
      and(eq(documents.entityType, entityType), eq(documents.entityId, entityId))
    )
    .orderBy(desc(documents.createdAt))
    .limit(MAX_DOCUMENTS_PER_ENTITY);
}

export async function listDocumentsForEntityIds(
  userId: string,
  entityType: string,
  entityIds: string[],
): Promise<DocumentRow[]> {
  requireAuth(userId);
  if (entityIds.length === 0) return [];
  await Promise.all(
    entityIds.map((entityId) =>
      assertCanManageDocumentEntity(userId, entityType, entityId)
    )
  );

  const rankedDocuments = db
    .select({
      ...getTableColumns(documents),
      documentRank: sql<number>`row_number() over (
        partition by ${documents.entityId}
        order by ${documents.createdAt} desc
      )`.as("document_rank"),
    })
    .from(documents)
    .where(
      and(
        eq(documents.entityType, entityType),
        inArray(documents.entityId, entityIds),
      ),
    )
    .as("ranked_documents");

  return db
    .select({
      id: rankedDocuments.id,
      entityType: rankedDocuments.entityType,
      entityId: rankedDocuments.entityId,
      documentType: rankedDocuments.documentType,
      storageProvider: rankedDocuments.storageProvider,
      storageBucket: rankedDocuments.storageBucket,
      storageKey: rankedDocuments.storageKey,
      fileUrl: rankedDocuments.fileUrl,
      fileName: rankedDocuments.fileName,
      fileSizeBytes: rankedDocuments.fileSizeBytes,
      mimeType: rankedDocuments.mimeType,
      checksumSha256: rankedDocuments.checksumSha256,
      visibility: rankedDocuments.visibility,
      uploadStatus: rankedDocuments.uploadStatus,
      issuedAt: rankedDocuments.issuedAt,
      capturedAt: rankedDocuments.capturedAt,
      description: rankedDocuments.description,
      metadata: rankedDocuments.metadata,
      createdBy: rankedDocuments.createdBy,
      notes: rankedDocuments.notes,
      createdAt: rankedDocuments.createdAt,
      updatedAt: rankedDocuments.updatedAt,
    })
    .from(rankedDocuments)
    .where(sql`${rankedDocuments.documentRank} <= ${MAX_DOCUMENTS_PER_ENTITY}`)
    .orderBy(desc(rankedDocuments.createdAt));
}

/**
 * Documents tagged with a given `metadata.kind` + `metadata.removalId`. Used by
 * the transport evidence-ledger flow to locate a removal's prior auto-generated
 * ledgers (which it supersedes), regardless of which member credit batch each
 * was attached to. Newest first. Current authz is single-org/shared-data; this
 * validates that the requested removal exists instead of relying on an upstream
 * submission context.
 */
export async function listDocumentsByKindForRemoval(
  userId: string,
  kind: string,
  removalId: string
): Promise<DocumentRow[]> {
  requireAuth(userId);
  await assertRemovalExistsForDocumentLookup(removalId);
  return db
    .select()
    .from(documents)
    .where(
      and(
        sql`${documents.metadata} ->> 'kind' = ${kind}`,
        sql`${documents.metadata} ->> 'removalId' = ${removalId}`
      )
    )
    .orderBy(desc(documents.createdAt))
    .limit(MAX_DOCUMENTS_PER_ENTITY);
}

export async function getDocumentById(
  userId: string,
  id: string
): Promise<DocumentRow | null> {
  requireAuth(userId);
  const [row] = await db.select().from(documents).where(eq(documents.id, id));
  return row ?? null;
}

/**
 * Unauthenticated lookup used by the public document proxy route. Returns the
 * row only when visibility is "public"; callers must use getDocumentById for
 * any private-document access.
 */
export async function getPublicDocumentById(
  id: string
): Promise<DocumentRow | null> {
  const [row] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.visibility, "public")));
  return row ?? null;
}

export async function insertDocument(
  userId: string,
  input: NewDocumentRow
): Promise<DocumentRow> {
  requireAuth(userId);
  const [row] = await db.insert(documents).values(input).returning();
  return row;
}

export async function updateDocument(
  userId: string,
  id: string,
  patch: Partial<NewDocumentRow>
): Promise<DocumentRow | null> {
  requireAuth(userId);
  const [row] = await db
    .update(documents)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(documents.id, id))
    .returning();
  return row ?? null;
}

export async function deleteDocumentRow(
  userId: string,
  id: string
): Promise<DocumentRow | null> {
  requireAuth(userId);
  const [row] = await db
    .delete(documents)
    .where(eq(documents.id, id))
    .returning();
  return row ?? null;
}
