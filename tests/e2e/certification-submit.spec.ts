/**
 * Phase 3 — Certify panel rendering smoke test.
 *
 * Scope: the deterministic, no-network gating state. With no
 * `certifier_projects` row, `loadCertifyContextForCreditBatchForUser`
 * short-circuits before any Isometric API call, so this test runs
 * independently of whether `ISOMETRIC_CLIENT_SECRET` /
 * `ISOMETRIC_ACCESS_TOKEN` are set.
 *
 * Out of scope (deferred to Phase 5+): the linked-state rendering
 * branches (no-default-template, drift, fully-resolved) — covered by
 * `tests/isometric-certify-context.test.ts` against mocked dependencies
 * — and the credit-batch happy-path E2E that exercises
 * `submitCreditBatch` against a real or mocked Certify API.
 */
import { Pool } from "pg";
import { expect, test } from "./fixtures";
import { seedCreditBatch } from "./fixtures/seed-chain-data";

const NOT_LINKED_FRAGMENT = /isn't linked to an Isometric project/i;

test.describe("Certify panel — credit-batch side sheet", () => {
  test("renders the not-linked state when the facility has no certifier project", async ({
    adminPage: page,
    seededData,
  }) => {
    const testRunId = seededData.facility.code.replace(/^E2E-FAC-/, "");
    const batch = await seedCreditBatch(seededData.facility.id, testRunId);

    await page.goto(`/credit-batches?facility=${seededData.facility.id}`);

    const card = page.locator("article").filter({ hasText: batch.code });
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.click();

    const sideSheet = page.locator('[role="dialog"]');
    await expect(sideSheet).toBeVisible({ timeout: 10000 });

    const certifyHeader = sideSheet.getByText("Isometric Certify", {
      exact: true,
    });
    await expect(certifyHeader).toBeVisible();

    // Slim panel: env banner is rendered inline alongside the not-linked
    // copy so operators can see which environment they're not linked to.
    await expect(
      sideSheet.getByText(/Sandbox · Isometric registry/i),
    ).toBeVisible();

    await expect(sideSheet.getByText(NOT_LINKED_FRAGMENT)).toBeVisible();
    await expect(
      sideSheet.getByRole("button", { name: /submit to isometric/i }),
    ).toHaveCount(0);

    // Deep-link out to the certification surface should always be reachable
    // from the slim panel.
    await expect(
      sideSheet.getByRole("link", { name: /view in certification/i }),
    ).toBeVisible();

    const databaseUrl =
      process.env.DATABASE_URL ||
      "postgresql://postgres:postgres@localhost:5432/app_template_test";
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM certification_submissions
         WHERE local_entity_type = 'creditBatch'
           AND local_entity_id = $1`,
        [batch.id],
      );
      expect(Number(rows[0]?.count ?? "0")).toBe(0);
    } finally {
      await pool.end();
    }
  });
});
