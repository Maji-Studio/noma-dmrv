/**
 * Certification → removal guided Review flow E2E (Stage 4 remodel + the
 * post-remodel `runSummary` deferral resolved in this session).
 *
 * The happy path: a credit batch grouped into a Removal, with a resolvable
 * Isometric removal template and a full traceability chain, drives the guided
 * StepFlow (Assemble → Review) and asserts the Review step now renders the
 * run-summary table — "Production runs / Biochar output / Applied" — which only
 * shows once `buildRemovalContext` resolves at least one production run
 * (`ctx.runSummary.runCount > 0`, review-step.tsx).
 *
 * THE GOTCHA (see remodel handoff): that resolution needs BOTH a real sandbox
 * removal template (the mapping's `defaultRemovalTemplateId` must match one
 * `listRemovalTemplates` returns) AND a chain that walks to a run. So the test
 * is gated on sandbox creds + project id (skips on CI without secrets), and it
 * live-resolves a template id at setup — skipping cleanly if the project has
 * none. The `runSummary` arithmetic itself is unit-tested in
 * `tests/certification-mass-accounting.test.ts`; this proves the wiring.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: false });

import { expect, test } from "./fixtures";
import {
  SANDBOX_PROJECT_ID,
  fetchSandboxRemovalTemplateId,
  seedCertifierMapping,
  seedGroupedRemovalWithChain,
} from "./fixtures/certification-helpers";

test.describe("Certification — removal guided Review flow", () => {
  test.skip(
    !SANDBOX_PROJECT_ID,
    "ISOMETRIC_DEMO_PROJECT_ID is required for the removal Review happy path (set in .env.local or CI secrets).",
  );

  test("steps Assemble → Review and shows the run-summary table", async ({
    adminPage: page,
    seededData,
  }) => {
    const externalProjectId = SANDBOX_PROJECT_ID!;
    const facilityId = seededData.facility.id;
    const testRunId = seededData.facility.code.replace(/^E2E-FAC-/, "");

    // The runSummary table only renders once a removal template resolves — so a
    // sandbox project with no templates has nothing to assert; skip cleanly.
    const templateId = await fetchSandboxRemovalTemplateId(externalProjectId);
    test.skip(
      !templateId,
      "Sandbox project returned no removal templates — cannot resolve the default template the runSummary table depends on.",
    );

    const mapping = await seedCertifierMapping(facilityId, {
      externalProjectId,
      defaultRemovalTemplateId: templateId,
    });
    const removal = await seedGroupedRemovalWithChain(
      {
        facilityId,
        reactorId: seededData.reactor.id,
        formulationId: seededData.formulation.id,
        feedstockId: seededData.feedstock.id,
        feedstockStorageLocationId: seededData.feedstockStorageLocation.id,
        biocharStorageLocationId: seededData.biocharStorageLocation.id,
        customerId: seededData.customer.id,
        customerLocationId: seededData.customerLocation.id,
        vehicleId: seededData.vehicle.id,
      },
      testRunId,
    );

    try {
      await page.goto(
        `/certification/removals/${removal.removalId}/review?facility=${facilityId}`,
      );

      // Lands on the guided flow (Assemble step is the default).
      await expect(
        page.getByRole("heading", { name: "Review & submit", level: 1 }),
      ).toBeVisible({ timeout: 20000 });

      // Advance Assemble → Review (Next is enabled because the removal has a
      // member batch — the only forward gate in the flow).
      await page.getByRole("button", { name: "Next", exact: true }).click();

      // The Review step composition.
      await expect(
        page.getByRole("heading", { name: "Review", exact: true, level: 2 }),
      ).toBeVisible();
      await expect(page.getByText(removal.creditBatch.code)).toBeVisible();

      // The runSummary table — this session's deferral, gated on runCount > 0,
      // so its presence proves the chain resolved a production run. `exact`
      // avoids the sidebar's "Production Runs" / "Biochar Products" nav links.
      await expect(
        page.getByText("Production runs", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Biochar output", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Applied (this removal)", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(/A removal counts only the biochar that reached soil/i),
      ).toBeVisible();
    } finally {
      // Run both cleanups even if the first throws, so a failed removal
      // teardown can't leak the seeded certifier mapping.
      try {
        await removal.cleanup();
      } finally {
        await mapping.cleanup();
      }
    }
  });
});
