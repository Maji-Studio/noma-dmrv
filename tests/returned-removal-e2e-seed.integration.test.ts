/**
 * Rot guard for the returned Removal E2E seed (tests/e2e/fixtures/returned-removal-seed.ts).
 * The three returned Removal screen specs only run locally (`pnpm test:e2e:returned`),
 * so this seeds the same chains in the integration job. The seed compiles the sent
 * state for real and asserts the comparison reads unchanged or changed; a compile
 * refusal throws here. No browser and no server: the registry reads are answered
 * by the same preload the specs use.
 */
import { afterEach, beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { certifierRemovals, organizations, users } from "@/db/schema";
import { withFixtureOrg } from "./e2e/fixtures/fixture-org";
import { cleanupChainData, seedChainData, type SeededChainData } from "./e2e/fixtures/seed-chain-data";
import { seedReturnedConnection, seedReturnedRemoval, type SeededReturnedRemoval } from "./e2e/fixtures/returned-removal-seed";

// A throwaway organization: parallel files (production-bootstrap) delete DEC inside a transaction, which committed rows there would block.
const organizationId = `org_returned_seed_${crypto.randomUUID().slice(0, 8)}`;
const adminUserId = crypto.randomUUID();
const seeded: SeededReturnedRemoval[] = [];
let chain: SeededChainData | undefined;
let cleanupConnection: (() => Promise<void>) | undefined;

beforeEach(async () => {
  await db.insert(organizations).values({ id: organizationId, name: "Returned seed guard", slug: organizationId });
  await db.insert(users).values({ id: adminUserId, email: `${adminUserId}@example.test`, emailVerified: true, role: "admin" });
  await withFixtureOrg(organizationId, async () => {
    chain = await seedChainData(crypto.randomUUID().slice(0, 8).toUpperCase());
    cleanupConnection = await seedReturnedConnection(chain.facility.id);
  });
});

afterEach(async () => {
  await withFixtureOrg(organizationId, async () => {
    for (const removal of seeded.splice(0).reverse()) await removal.cleanup();
    await cleanupConnection?.();
    if (chain) await cleanupChainData(chain);
  });
  chain = undefined;
  await db.delete(users).where(eq(users.id, adminUserId));
  await db.delete(organizations).where(eq(organizations.id, organizationId));
});

for (const changed of [false, true]) {
  it(`seeds a submit-ready returned Removal that reads ${changed ? "changed" : "unchanged"}`, async () => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const removal = await withFixtureOrg(organizationId, () => seedReturnedRemoval(chain!, tag, {
      changed, adminUserId, statementStatus: "DRAFT", periodStartOn: "2026-04-01", periodEndOn: "2026-06-30",
    }));
    seeded.push(removal);
    // Every row of the chain belongs to the throwaway organization, never to DEC.
    const [removalRow] = await db.select({ organizationId: certifierRemovals.organizationId }).from(certifierRemovals).where(eq(certifierRemovals.id, removal.removalId));
    expect(removalRow.organizationId).toBe(organizationId);
  }, 60_000);
}
