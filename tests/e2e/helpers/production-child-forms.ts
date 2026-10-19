import type { Locator } from "@playwright/test";
import { expect } from "../fixtures";

export async function validateAndSaveMeasurement(sampleDialog: Locator) {
  await expect(sampleDialog.getByText(/^Facility time:/)).toBeVisible();
  await sampleDialog.locator("#timestamp").fill("");
  await sampleDialog.getByRole("button", { name: "Add Sample", exact: true }).click();
  await expect(sampleDialog.locator("#timestamp-error")).toHaveText("Enter the measurement time.");
  await sampleDialog.locator("#timestamp").fill("2026-09-01T12:00");
  await sampleDialog.getByRole("button", { name: "Add Sample", exact: true }).click();
  await expect(sampleDialog.locator("#weightGrams-error")).toHaveText("Enter at least one measured value.");
  await sampleDialog.locator("#volumeMl").fill("-1");
  await sampleDialog.getByRole("button", { name: "Add Sample", exact: true }).click();
  await expect(sampleDialog.locator("#volumeMl-error")).toBeVisible();
  await sampleDialog.locator("#volumeMl").fill("0");
  await expect(sampleDialog.locator("#weightGrams-error")).toBeHidden();
  await expect(sampleDialog.locator("#volumeMl-error")).toBeHidden();
  await sampleDialog.getByRole("button", { name: "Add Sample", exact: true }).click();

}

export async function validateAndSaveIncident(incidentDialog: Locator) {
  await expect(incidentDialog.getByText(/^Facility time:/)).toBeVisible();
  await incidentDialog.locator("#incidentTime").fill("");
  await incidentDialog.locator("#description").fill("E2E incident time validation");
  await incidentDialog.getByRole("button", { name: "Add incident", exact: true }).click();
  await expect(incidentDialog.locator("#incidentTime-error")).toHaveText("Enter the incident time.");
  await incidentDialog.locator("#incidentTime").fill("2026-09-01T12:00");
  await incidentDialog.getByRole("button", { name: "Add incident", exact: true }).click();

}
