/**
 * Guided Removal template setup (#1276): the Settings summary, the setup
 * dialog and the Member view.
 *
 * The dialog reads the facility's templates live from the Isometric sandbox, so
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

// The dialog waits on live Isometric reads; the first dev compile is slow too.
const LIVE_READ_TIMEOUT_MS = 60_000;
const SETTINGS_PATH = "/settings/removal-templates";

test.describe("Removal template setup", { tag: "@live" }, () => {
  test.skip(!SANDBOX_PROJECT_ID, "requires an Isometric sandbox project ID (ISOMETRIC_DEMO_PROJECT_ID)");

  let mapping: SeededMapping | undefined;
  test.afterEach(async () => {
    await mapping?.cleanup();
    mapping = undefined;
  });

  test("an Admin opens the dialog from the empty Settings pane and walks the steps", async ({ adminPage: page, seededData, cleanupTestData }) => {
    void cleanupTestData;
    const facilityId = seededData.facility.id;
    await setFacilityDurabilityTier(facilityId, "1000_year");
    mapping = await seedCertifierMapping(facilityId, { externalProjectId: SANDBOX_PROJECT_ID as string });

    await page.goto(`${SETTINGS_PATH}?facility=${facilityId}`);
    await expect(page.getByText("No Removal template set")).toBeVisible({ timeout: LIVE_READ_TIMEOUT_MS });
    await page.getByRole("button", { name: "Set up template" }).click();

    // The dialog sits over the pane: same page, params mark it open.
    const dialog = page.getByRole("dialog", { name: "Set up Removal template" });
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/removal-templates/);
    await expect(page).toHaveURL(/setup=template/);
    await expect(dialog.getByRole("heading", { name: "Pick the template" })).toBeAttached({ timeout: LIVE_READ_TIMEOUT_MS });

    // Every template of the project is listed; several fits start with nothing picked, and Next waits for a pick.
    const radios = dialog.getByRole("radio");
    await expect(radios.first()).toBeVisible({ timeout: LIVE_READ_TIMEOUT_MS });
    if ((await dialog.getByRole("radio", { disabled: false }).count()) > 1) {
      await expect(dialog.getByRole("radio", { checked: true })).toHaveCount(0);
      await dialog.getByRole("button", { name: "Next" }).click();
      await expect(dialog.getByText("Pick a template to continue.")).toBeVisible();
      await dialog.getByRole("radio", { disabled: false }).first().check({ force: true });
    }
    await dialog.getByRole("button", { name: "Next" }).click();

    // A template with questions opens Decisions, one with none goes straight to Apply.
    const heading = dialog.getByRole("heading", { name: /^(Decide what noma cannot|Apply the setup)$/ });
    await expect(heading).toBeAttached();
    if ((await heading.textContent()) === "Decide what noma cannot") {
      await dialog.getByRole("button", { name: "Next" }).click();
      await expect(dialog.getByText(/to decide:/)).toBeVisible();
    }
    await dialog.getByRole("button", { name: "Back" }).click();

    // Cancel leaves nothing behind: the dialog closes and the params go with it.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(page).not.toHaveURL(/setup=/);
    await expect(page.getByText("No Removal template set")).toBeVisible();
  });

  test("a Member sees the read-only card and a setup link does not open the dialog", async ({ operatorPage: page, seededData, cleanupTestData }) => {
    void cleanupTestData;
    const facilityId = seededData.facility.id;
    mapping = await seedCertifierMapping(facilityId, { externalProjectId: SANDBOX_PROJECT_ID as string });

    await page.goto(`${SETTINGS_PATH}?facility=${facilityId}&setup=template`);
    await expect(page.getByText("No Removal template set")).toBeVisible({ timeout: LIVE_READ_TIMEOUT_MS });
    await expect(page.getByRole("button", { name: "Set up template" })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Set up Removal template" })).toHaveCount(0);
    await expect(page.getByText("Admins can change these.")).toBeVisible();
  });
});
