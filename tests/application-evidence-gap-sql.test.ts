/**
 * Integration coverage for the evidence-gap SQL — the fail-CLOSED certify
 * readiness signal.
 *
 * `applicationEvidenceGapCountSql()` (src/data-access/application-evidence-sql.ts)
 * is the single source of truth for `ApplicationListItem.evidenceGapCount`
 * (consumed by `deriveEntityCertifyReadiness`) and the dashboard attention
 * count. Its behaviour is asserted only through its correlated form inside
 * `getApplications`; no test previously executed it against a real database.
 *
 * A metadata-key rename (`geotagStatus` / `evidenceRole` / `logbookEvidenceType`)
 * or a CASE-precedence slip could silently undercount gaps to 0 and flip an
 * unready application to certify-ready (fail-open). This test:
 *
 *   1. Seeds applications across every interesting branch (visual roles,
 *      geotag/upload predicates, boundary logbook document types, GIS-reference
 *      blankness).
 *   2. Asserts the SQL-derived `evidenceGapCount` from `getApplications` against
 *      hand-specified expectations.
 *   3. Cross-checks each count against the JS twin `buildApplicationEvidenceGaps`
 *      run over the same fixtures — proving the two implementations equivalent,
 *      not merely taxonomy-aligned.
 *
 * The application `evidence_method` column is NOT NULL (default `visual`), so
 * the CASE's non-boundary `else` branch is only ever reached by `visual` rows;
 * the JS twin's `undefined` short-circuit is therefore unreachable here and the
 * two paths agree on every DB-reachable row.
 *
 * Skips when DATABASE_URL is unreachable, matching the other DB-backed specs.
 */
import {
  APPLICATION_EVIDENCE_FIXTURES,
  type ApplicationEvidenceFixture,
} from "./helpers/application-evidence-fixtures";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { getApplications } from "@/data-access/applications";
import { buildApplicationEvidenceGaps } from "@/fn/certification/application-evidence-readiness";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { applications } from "@/db/schema/application";
import { documents } from "@/db/schema/documentation";
import { facilities, reactors } from "@/db/schema/facilities";
import { feedstockTypes } from "@/db/schema/feedstock";
import { deliveries, orders } from "@/db/schema/logistics";
import { customers } from "@/db/schema/parties";
import { biocharProducts, formulations } from "@/db/schema/products";
import { productionProcesses } from "@/db/schema/production-processes";
import { productionRuns } from "@/db/schema/production";

const TEST_USER_ID = "test-user-evidence-gap-sql";
const APPLICATION_DOCUMENT_ENTITY_TYPE = "application";
const UPLOADED_PHOTO_URL = "https://example.test/evidence.jpg";
const PENDING_STORAGE = {
  storageProvider: "local-fs",
  storageBucket: "test-bucket",
  storageKey: "pending/evidence.jpg",
} as const;
const LIST_PAGE_SIZE = 100;

/**
 * One application per branch, shared with the pure/in-memory contract suite
 * (`src/lib/certification/application-evidence.test.ts`) so the two matrices
 * cannot drift. Each `expectedGapCount` is asserted both against the SQL and
 * against the JS twin.
 */
const APP_SPECS = APPLICATION_EVIDENCE_FIXTURES;

interface SeededApplication {
  id: string;
  code: string;
  spec: ApplicationEvidenceFixture;
}

interface Fixture {
  facilityId: string;
  customerId: string;
  formulationId: string;
  feedstockTypeId: string;
  productionProcessId: string;
  reactorId: string;
  productionRunId: string;
  productId: string;
  orderId: string;
  deliveryId: string;
  applications: SeededApplication[];
  documentIds: string[];
}

let dbReachable = true;
let fixture: Fixture | null = null;

/** `db` or a transaction client — seeding runs inside one transaction so a
 * partial setup failure rolls back instead of leaking rows. */
type DbClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

async function seedDeliveryChain(
  dbc: DbClient,
  runId: string,
): Promise<Omit<Fixture, "applications" | "documentIds">> {
  const [customer] = await dbc
    .insert(customers)
    .values({ organizationId: TEST_ORG_ID, name: `Gap Customer ${runId}`, code: `CU-GAP-${runId}` })
    .returning({ id: customers.id });

  const [formulation] = await dbc
    .insert(formulations)
    .values({ organizationId: TEST_ORG_ID, name: `Gap Formulation ${runId}`, code: `FM-GAP-${runId}` })
    .returning({ id: formulations.id });

  const [feedstockType] = await dbc
    .insert(feedstockTypes)
    .values({
      organizationId: TEST_ORG_ID,
      name: `Gap Feedstock ${runId}`,
      code: `FT-GAP-${runId}`,
      category: "forestry",
    })
    .returning({ id: feedstockTypes.id });

  const [facility] = await dbc
    .insert(facilities)
    .values({ organizationId: TEST_ORG_ID, name: `Gap Facility ${runId}`, code: `FAC-GAP-${runId}` })
    .returning({ id: facilities.id });

  const [productionProcess] = await dbc
    .insert(productionProcesses)
    .values({
      organizationId: TEST_ORG_ID,
      facilityId: facility.id,
      feedstockTypeId: feedstockType.id,
    })
    .returning({ id: productionProcesses.id });

  const [reactor] = await dbc
    .insert(reactors)
    .values({
      organizationId: TEST_ORG_ID,
      code: `RE-GAP-${runId}`,
      facilityId: facility.id,
      identifier: `Gap Reactor ${runId}`,
      reactorType: "fixed-bed",
    })
    .returning({ id: reactors.id });

  const [productionRun] = await dbc
    .insert(productionRuns)
    .values({
      organizationId: TEST_ORG_ID,
      code: `PR-GAP-${runId}`,
      facilityId: facility.id,
      reactorId: reactor.id,
      startTime: new Date("2025-06-15T08:00:00Z"),
      endTime: new Date("2025-06-15T12:00:00Z"),
      biocharDryMassKg: 10_000,
    })
    .returning({ id: productionRuns.id });

  const [product] = await dbc
    .insert(biocharProducts)
    .values({
      organizationId: TEST_ORG_ID,
      code: `BP-GAP-${runId}`,
      facilityId: facility.id,
      formulationId: formulation.id,
      linkedProductionRunId: productionRun.id,
    })
    .returning({ id: biocharProducts.id });

  const [order] = await dbc
    .insert(orders)
    .values({
      organizationId: TEST_ORG_ID,
      code: `OR-GAP-${runId}`,
      facilityId: facility.id,
      biocharProductId: product.id,
      customerId: customer.id,
      orderDate: new Date("2025-06-01"),
      quantityKg: 1000,
      packaging: "bagged",
    })
    .returning({ id: orders.id });

  const [delivery] = await dbc
    .insert(deliveries)
    .values({
      organizationId: TEST_ORG_ID,
      code: `DL-GAP-${runId}`,
      facilityId: facility.id,
      orderId: order.id,
      deliveryDate: new Date("2025-06-10"),
      deliveredWetMassKg: 10_000,
    })
    .returning({ id: deliveries.id });

  return {
    facilityId: facility.id,
    customerId: customer.id,
    formulationId: formulation.id,
    feedstockTypeId: feedstockType.id,
    productionProcessId: productionProcess.id,
    reactorId: reactor.id,
    productionRunId: productionRun.id,
    productId: product.id,
    orderId: order.id,
    deliveryId: delivery.id,
  };
}

async function seedApplicationsAndDocuments(
  dbc: DbClient,
  chain: Omit<Fixture, "applications" | "documentIds">,
  runId: string,
): Promise<Pick<Fixture, "applications" | "documentIds">> {
  const seededApplications: SeededApplication[] = [];
  const documentIds: string[] = [];

  for (const [index, spec] of APP_SPECS.entries()) {
    const [application] = await dbc
      .insert(applications)
      .values({
        organizationId: TEST_ORG_ID,
        code: `AP-GAP-${runId}-${index}`,
        deliveryId: chain.deliveryId,
        applicationDate: new Date("2025-06-15"),
        biocharAppliedTons: 5,
        biocharAppliedDryTons: 4.5,
        evidenceMethod: spec.evidenceMethod,
        gisBoundaryReference: spec.gisBoundaryReference,
      })
      .returning({ id: applications.id, code: applications.code });

    seededApplications.push({ id: application.id, code: application.code, spec });

    for (const [docIndex, doc] of spec.docs.entries()) {
      const [inserted] = await dbc
        .insert(documents)
        .values({
          organizationId: TEST_ORG_ID,
          entityType: APPLICATION_DOCUMENT_ENTITY_TYPE,
          entityId: application.id,
          documentType: doc.documentType,
          fileName: `${spec.key}-${docIndex}`,
          metadata: doc.metadata,
          ...(doc.pending
            ? { uploadStatus: "pending" as const, ...PENDING_STORAGE }
            : { uploadStatus: "uploaded" as const, fileUrl: UPLOADED_PHOTO_URL }),
        })
        .returning({ id: documents.id });
      documentIds.push(inserted.id);
    }
  }

  return { applications: seededApplications, documentIds };
}

async function cleanupFixture(target: Fixture): Promise<void> {
  await db.transaction(async (tx) => {
    if (target.documentIds.length > 0) {
      await tx.delete(documents).where(inArray(documents.id, target.documentIds));
    }
    const applicationIds = target.applications.map((app) => app.id);
    if (applicationIds.length > 0) {
      await tx.delete(applications).where(inArray(applications.id, applicationIds));
    }
    await tx.delete(deliveries).where(eq(deliveries.id, target.deliveryId));
    await tx.delete(orders).where(eq(orders.id, target.orderId));
    await tx.delete(biocharProducts).where(eq(biocharProducts.id, target.productId));
    await tx.delete(productionRuns).where(eq(productionRuns.id, target.productionRunId));
    await tx.delete(reactors).where(eq(reactors.id, target.reactorId));
    await tx.delete(formulations).where(eq(formulations.id, target.formulationId));
    await tx.delete(customers).where(eq(customers.id, target.customerId));
    await tx
      .delete(productionProcesses)
      .where(eq(productionProcesses.id, target.productionProcessId));
    await tx.delete(facilities).where(eq(facilities.id, target.facilityId));
    await tx.delete(feedstockTypes).where(eq(feedstockTypes.id, target.feedstockTypeId));
  });
}

/** Minimal lineage carrying only the fields the JS twin reads. */
function lineageFor(app: SeededApplication): ChainOfCustodyData {
  return {
    facility: { id: "fac", code: "F", name: "Facility" },
    application: {
      id: app.id,
      code: app.code,
      status: "applied",
      applicationDate: new Date("2025-06-15"),
      fieldIdentifier: null,
      evidenceMethod: app.spec.evidenceMethod,
      gisBoundaryReference: app.spec.gisBoundaryReference,
      biocharAppliedDryTons: 4.5,
      soilTemperatureC: null,
      href: `/applications/${app.id}`,
    },
    delivery: {
      id: "del",
      code: "DL",
      status: null,
      deliveryDate: new Date("2025-06-10"),
      massDryKg: null,
      href: "/deliveries/del",
    },
    order: null,
    biocharProduct: null,
    productionRun: null,
    reactor: null,
    feedstocks: [],
    warnings: [],
  };
}

beforeAll(async () => {
  const runId = crypto.randomUUID().slice(0, 8);
  // Skip only on genuine unreachability; any later seeding failure must fail
  // the suite loudly — this spec guards a fail-closed signal, and a silent
  // skip on a schema regression would be exactly the fail-open it exists to catch.
  try {
    await db.execute(sql`select 1`);
  } catch {
    dbReachable = false;
    return;
  }
  await ensureTestOrg();
  // One transaction: a partial seeding failure rolls back instead of leaking
  // rows, and the original error propagates.
  fixture = await db.transaction(async (tx) => {
    const chain = await seedDeliveryChain(tx, runId);
    const seeded = await seedApplicationsAndDocuments(tx, chain, runId);
    return { ...chain, ...seeded };
  });
});

afterAll(async () => {
  if (fixture) {
    await cleanupFixture(fixture);
  }
});

describe("applicationEvidenceGapCountSql (via getApplications)", () => {
  it("matches hand-specified gap counts for every evidence branch", async (ctx) => {
    if (!dbReachable || !fixture) {
      ctx.skip();
      return;
    }

    const orgCtx = makeTestOrgContext(TEST_USER_ID);
    const { items } = await getApplications(orgCtx, {
      facilityId: fixture.facilityId,
      pageSize: LIST_PAGE_SIZE,
    });
    const gapCountByCode = new Map(
      items.map((item) => [item.code, item.evidenceGapCount]),
    );

    for (const app of fixture.applications) {
      expect(
        gapCountByCode.get(app.code),
        `SQL gap count for ${app.spec.key}`,
      ).toBe(app.spec.expectedGapCount);
    }
  });

  it("agrees with the JS twin buildApplicationEvidenceGaps on the same fixtures", async (ctx) => {
    if (!dbReachable || !fixture) {
      ctx.skip();
      return;
    }

    const orgCtx = makeTestOrgContext(TEST_USER_ID);
    const { items } = await getApplications(orgCtx, {
      facilityId: fixture.facilityId,
      pageSize: LIST_PAGE_SIZE,
    });
    const sqlGapCountByCode = new Map(
      items.map((item) => [item.code, item.evidenceGapCount]),
    );

    // JS twin reads the same seeded documents from the DB, one application at a
    // time, so the returned gap strings are attributable per application.
    for (const app of fixture.applications) {
      const gaps = await buildApplicationEvidenceGaps(orgCtx, [lineageFor(app)]);
      expect(
        sqlGapCountByCode.get(app.code),
        `SQL vs JS-twin equivalence for ${app.spec.key}`,
      ).toBe(gaps.length);
    }
  });
});
