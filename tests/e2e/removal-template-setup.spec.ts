/**
 * Guided Removal template setup (#1276): the Settings summary, the setup page
 * and the Member redirect.
 *
 * The page reads the facility's templates live from the Isometric sandbox, so
 * the spec is skipped without `ISOMETRIC_DEMO_PROJECT_ID` and is tagged @live.
 * It walks the steps and stops before Apply: which sandbox templates are fully
 * bound changes with the project, and Apply is covered by the component and
 * integration tests.
 */
import { expect, test } from "./fixtures";
import {
  SANDBOX_PROJECT_ID,
  seedCertifierMapping,
  setFacilityDurabilityTier,
  type SeededMapping,
} from "./fixtures/certification-helpers";

// The page waits on live Isometric reads; the first dev compile is slow too.
const LIVE_READ_TIMEOUT_MS = 60_000;
const SETTINGS_PATH = "/certification/settings";
const SETUP_PATH = "/certification/settings/removal-template-setup";

test.describe("Removal template setup", { tag: "@live" }, () => {
  test.skip(!SANDBOX_PROJECT_ID, "requires an Isometric sandbox project ID (ISOMETRIC_DEMO_PROJECT_ID)");

  let mapping: SeededMapping | undefined;
  test.afterEach(async () => {
    await mapping?.cleanup();
    mapping = undefined;
  });

  test("an Admin walks from the empty Settings pane through the steps", async ({ adminPage: page, seededData, cleanupTestData }) => {
    void cleanupTestData;
    const facilityId = seededData.facility.id;
    await setFacilityDurabilityTier(facilityId, "1000_year");
    mapping = await seedCertifierMapping(facilityId, { externalProjectId: SANDBOX_PROJECT_ID as string });

    await page.goto(`${SETTINGS_PATH}?section=removal-templates&facility=${facilityId}`);
    await expect(page.getByText("No Removal template set")).toBeVisible({ timeout: LIVE_READ_TIMEOUT_MS });
    await page.getByRole("link", { name: "Set up template" }).click();

    await expect(page).toHaveURL(new RegExp(`${SETUP_PATH}\\?facility=${facilityId}`));
    await expect(page.getByRole("heading", { name: "Set up Removal template" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "What happens" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pick the template" })).toBeVisible({ timeout: LIVE_READ_TIMEOUT_MS });

    // Several fits start with nothing picked, and Continue waits for a pick.
    const radios = page.getByRole("radio");
    await expect(radios.first()).toBeVisible({ timeout: LIVE_READ_TIMEOUT_MS });
    if ((await radios.count()) > 1) {
      await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByText("Pick a template to continue.")).toBeVisible();
      await radios.first().check({ force: true });
    }
    await page.getByRole("button", { name: "Continue" }).click();

    // A template with questions opens Decisions, one with none goes straight to Apply.
    const heading = page.getByRole("heading", { name: /^(Decide what noma cannot|Apply the setup)$/ });
    await expect(heading).toBeVisible();
    if ((await heading.textContent()) === "Decide what noma cannot") {
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByText(/to decide:/)).toBeVisible();
      await page.getByRole("button", { name: /^Template/ }).click();
      await expect(page.getByRole("heading", { name: "Pick the template" })).toBeVisible();
    }
  });

  test("a Member is sent back to the read-only Settings pane", async ({ operatorPage: page, seededData, cleanupTestData }) => {
    void cleanupTestData;
    const facilityId = seededData.facility.id;
    mapping = await seedCertifierMapping(facilityId, { externalProjectId: SANDBOX_PROJECT_ID as string });

    await page.goto(`${SETUP_PATH}?facility=${facilityId}`);
    await expect(page).toHaveURL(new RegExp(`${SETTINGS_PATH}\\?.*section=removal-templates`), { timeout: LIVE_READ_TIMEOUT_MS });
    await expect(page.getByText("No Removal template set")).toBeVisible({ timeout: LIVE_READ_TIMEOUT_MS });
    await expect(page.getByRole("link", { name: "Set up template" })).toHaveCount(0);
    await expect(page.getByText("Owners and Admins can change these.")).toBeVisible();
  });
});
