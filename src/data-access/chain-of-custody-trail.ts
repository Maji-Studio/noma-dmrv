/**
 * Chain of custody — Trail evidence resolver (chain-of-custody views Phase 3).
 *
 * The Trail is one merged reading (plan decision 4): each custody step with
 * its date and what attests it. Step identity, dates, and masses already live
 * in `ChainOfCustodyData` — this resolver supplies only the evidence joins:
 * linked documents (polymorphic `documents` by entityType/entityId: weigh
 * tickets, COAs, lab reports, photos), production-run samples, and
 * transport-leg `distanceSource` provenance (with the legs' own
 * bill-of-lading / weigh-ticket documents nested).
 *
 * Evidence is keyed by the DAG node-id convention (`kind:entityId`,
 * `use-chain-graph.ts`) so the Trail cross-links with every other reading.
 */
import { and, desc, eq, inArray, or, type SQL } from "drizzle-orm";
import type { OrgContext } from "@/lib/auth/server";
import { db } from "@/db";
import { documents } from "@/db/schema";
import type { DistanceSourceValue } from "@/schemas/distance-source";
import type { DocumentEntityType } from "@/schemas/documents";
import { resolveChainSources } from "@/lib/chain-of-custody/sources";
import { getChainOfCustodyData } from "./chain-of-custody";
import { getProductionSamples } from "./production-samples";
import { getTransportLegsForEntities } from "./transport-legs";
import { requireOrgScope } from "./utils";

/**
 * Hard cap across one application's full evidence sweep — a guardrail against
 * unbounded scans, mirroring `MAX_DOCUMENTS_PER_ENTITY` in documents.ts.
 */
const MAX_TRAIL_DOCUMENTS = 500;

export interface TrailDocument {
  id: string;
  fileName: string;
  documentType: string;
  issuedAt: Date | null;
  capturedAt: Date | null;
  createdAt: Date;
}

export interface TrailSample {
  id: string;
  sampleCode: string | null;
  timestamp: Date;
  photoUrl: string | null;
}

export interface TrailTransportLeg {
  id: string;
  distanceKm: number;
  distanceSource: DistanceSourceValue | null;
  isDerived: boolean;
  originName: string | null;
  destinationName: string | null;
  documents: TrailDocument[];
}

export interface TrailNodeEvidence {
  documents: TrailDocument[];
  samples: TrailSample[];
  transportLegs: TrailTransportLeg[];
}

export interface ApplicationTrailEvidence {
  /** Keyed by DAG node id (`kind:entityId`) — empty nodes are omitted. */
  byNodeId: Record<string, TrailNodeEvidence>;
  /** Total attesting records across all steps (Trail header count). */
  totalCount: number;
}

interface DocumentScope {
  entityType: DocumentEntityType;
  entityIds: string[];
}

type DocumentRowLean = TrailDocument & {
  entityType: string;
  entityId: string;
};

async function listDocumentsForScopes(
  ctx: OrgContext,
  scopes: DocumentScope[],
): Promise<DocumentRowLean[]> {
  const conditions: SQL[] = [];
  for (const scope of scopes) {
    if (scope.entityIds.length === 0) continue;
    conditions.push(
      and(
        eq(documents.entityType, scope.entityType),
        inArray(documents.entityId, scope.entityIds),
      )!,
    );
  }
  if (conditions.length === 0) return [];

  return db
    .select({
      id: documents.id,
      entityType: documents.entityType,
      entityId: documents.entityId,
      fileName: documents.fileName,
      documentType: documents.documentType,
      issuedAt: documents.issuedAt,
      capturedAt: documents.capturedAt,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(and(eq(documents.organizationId, ctx.organizationId), eq(documents.uploadStatus, "uploaded"), or(...conditions)))
    .orderBy(desc(documents.createdAt))
    .limit(MAX_TRAIL_DOCUMENTS);
}

function toTrailDocument(row: DocumentRowLean): TrailDocument {
  return {
    id: row.id,
    fileName: row.fileName,
    documentType: row.documentType,
    issuedAt: row.issuedAt,
    capturedAt: row.capturedAt,
    createdAt: row.createdAt,
  };
}

export async function getApplicationTrailEvidence(
  ctx: OrgContext,
  applicationId: string,
): Promise<ApplicationTrailEvidence> {
  requireOrgScope(ctx);

  const chain = await getChainOfCustodyData(ctx, applicationId);

  const feedstockIds = chain.feedstocks.map((feedstock) => feedstock.id);
  const sources = resolveChainSources(chain);
  const productionRunIds = sources.map(
    (source) => source.productionRun.id,
  );
  const biocharProductId = chain.biocharProduct?.id ?? null;

  const [feedstockLegs, biocharLegs, sampleRowsByRun] = await Promise.all([
    getTransportLegsForEntities(ctx, "feedstock", feedstockIds),
    getTransportLegsForEntities(
      ctx,
      "biochar",
      biocharProductId ? [biocharProductId] : [],
    ),
    Promise.all(
      productionRunIds.map(async (productionRunId) => ({
        productionRunId,
        samples: await getProductionSamples(ctx, productionRunId),
      })),
    ),
  ]);
  const samplesByRun = new Map(
    sampleRowsByRun.map(({ productionRunId, samples }) => [
      productionRunId,
      samples,
    ]),
  );

  const allLegs = [...feedstockLegs, ...biocharLegs];
  const documentRows = await listDocumentsForScopes(ctx, [
    { entityType: "feedstock", entityIds: feedstockIds },
    {
      entityType: "production_run",
      entityIds: productionRunIds,
    },
    {
      entityType: "biochar_product",
      entityIds: biocharProductId ? [biocharProductId] : [],
    },
    { entityType: "order", entityIds: chain.order ? [chain.order.id] : [] },
    { entityType: "delivery", entityIds: [chain.delivery.id] },
    { entityType: "application", entityIds: [chain.application.id] },
    { entityType: "transport_leg", entityIds: allLegs.map((leg) => leg.id) },
  ]);

  // Documents grouped per (entityType, entityId); transport-leg documents
  // nest under their leg instead of a step.
  const documentsByEntity = new Map<string, TrailDocument[]>();
  for (const row of documentRows) {
    const key = `${row.entityType}:${row.entityId}`;
    const list = documentsByEntity.get(key) ?? [];
    list.push(toTrailDocument(row));
    documentsByEntity.set(key, list);
  }
  const entityDocuments = (entityType: DocumentEntityType, entityId: string) =>
    documentsByEntity.get(`${entityType}:${entityId}`) ?? [];

  const toTrailLeg = (leg: (typeof allLegs)[number]): TrailTransportLeg => ({
    id: leg.id,
    distanceKm: leg.distanceKm,
    distanceSource: leg.distanceSource,
    isDerived: leg.isDerived,
    originName: leg.originName,
    destinationName: leg.destinationName,
    documents: entityDocuments("transport_leg", leg.id),
  });

  const byNodeId: Record<string, TrailNodeEvidence> = {};
  const addNode = (nodeId: string, evidence: TrailNodeEvidence) => {
    if (
      evidence.documents.length === 0 &&
      evidence.samples.length === 0 &&
      evidence.transportLegs.length === 0
    ) {
      return;
    }
    byNodeId[nodeId] = evidence;
  };

  for (const feedstock of chain.feedstocks) {
    addNode(`feedstock:${feedstock.id}`, {
      documents: entityDocuments("feedstock", feedstock.id),
      samples: [],
      transportLegs: feedstockLegs
        .filter((leg) => leg.entityId === feedstock.id)
        .map(toTrailLeg),
    });
  }

  for (const source of sources) {
    const productionRunId = source.productionRun.id;
    addNode(`production-run:${productionRunId}`, {
      documents: entityDocuments("production_run", productionRunId),
      samples: (samplesByRun.get(productionRunId) ?? []).map((sample) => ({
        id: sample.id,
        sampleCode: sample.sampleCode,
        timestamp: sample.timestamp,
        photoUrl: sample.photoUrl,
      })),
      transportLegs: [],
    });
  }

  if (chain.biocharProduct) {
    addNode(`biochar-product:${chain.biocharProduct.id}`, {
      documents: entityDocuments("biochar_product", chain.biocharProduct.id),
      samples: [],
      transportLegs: biocharLegs.map(toTrailLeg),
    });
  }

  if (chain.order) {
    addNode(`order:${chain.order.id}`, {
      documents: entityDocuments("order", chain.order.id),
      samples: [],
      transportLegs: [],
    });
  }

  addNode(`delivery:${chain.delivery.id}`, {
    documents: entityDocuments("delivery", chain.delivery.id),
    samples: [],
    transportLegs: [],
  });

  addNode(`application:${chain.application.id}`, {
    documents: entityDocuments("application", chain.application.id),
    samples: [],
    transportLegs: [],
  });

  const totalCount = Object.values(byNodeId).reduce(
    (sum, evidence) =>
      sum +
      evidence.documents.length +
      evidence.samples.length +
      evidence.transportLegs.length +
      evidence.transportLegs.reduce((s, leg) => s + leg.documents.length, 0),
    0,
  );

  return { byNodeId, totalCount };
}
