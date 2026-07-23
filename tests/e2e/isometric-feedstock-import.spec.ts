/**
 * Live browser coverage for the Isometric feedstock catalogue.
 *
 * The catalogue request is account-global and server-to-server, so this spec
 * uses sandbox credentials rather than pretending a browser route mock can
 * intercept it. It never imports from the UI: one local linkage is seeded,
 * then the dialog is inspected read-only.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: false });

import * as crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { BrowserContext } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { parse as parseEnv } from "dotenv";
import * as schema from "../../src/db/schema";
import { DEC_ORG_ID } from "../../src/db/org-defaults";
import { encryptSecret } from "../../src/lib/crypto/secrets";
import { expect, test } from "./fixtures";
import {
  seedCertifierMapping,
  SANDBOX_PROJECT_ID,
} from "./fixtures/certification-helpers";
import { createDbConnection } from "./fixtures/db";

const ISOMETRIC_BASE_URLS = {
  sandbox: "https://api.sandbox.isometric.com/mrv/v0",
  production: "https://api.isometric.com/mrv/v0",
} as const;
const localEnv = existsSync(".env.local")
  ? parseEnv(readFileSync(".env.local"))
  : {};
const ACCESS_TOKEN =
  process.env.ISOMETRIC_ACCESS_TOKEN || localEnv.ISOMETRIC_ACCESS_TOKEN;
const CLIENT_SECRET =
  process.env.ISOMETRIC_CLIENT_SECRET || localEnv.ISOMETRIC_CLIENT_SECRET;
const ISOMETRIC_ENVIRONMENT =
  (process.env.ISOMETRIC_ENVIRONMENT || localEnv.ISOMETRIC_ENVIRONMENT) ===
  "production"
    ? "production"
    : "sandbox";

interface CatalogueEntry {
  id: string;
  name: string;
  supplier_reference_id?: string | null;
}

async function loadLiveFeedstockTypes(): Promise<CatalogueEntry[]> {
  if (!ACCESS_TOKEN || !CLIENT_SECRET) return [];
  const response = await fetch(
    `${ISOMETRIC_BASE_URLS[ISOMETRIC_ENVIRONMENT]}/feedstock_types?first=50`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "X-Client-Secret": CLIENT_SECRET,
      },
    },
  );
  if (!response.ok) {
    throw new Error(
      `Isometric feedstock catalogue request failed with ${response.status}`,
    );
  }
  const body = (await response.json()) as { nodes?: CatalogueEntry[] };
  return body.nodes ?? [];
}

test.describe(
  "Isometric feedstock import dialog",
  { tag: "@live" },
  () => {
    test.skip(
      !ACCESS_TOKEN || !CLIENT_SECRET,
      "Isometric sandbox credentials are required for live catalogue coverage.",
    );

    test("prevents selecting an already-imported registry entry", async ({
      browser,
      baseURL,
      seededData,
    }) => {
      const catalogue = await loadLiveFeedstockTypes();
      test.skip(
        catalogue.length < 1,
        "The Isometric catalogue needs an entry for this check.",
      );

      const { db, pool } = createDbConnection();
      const credentialsWhere = and(
        eq(schema.certifierCredentials.organizationId, DEC_ORG_ID),
        eq(schema.certifierCredentials.provider, "isometric"),
      );
      const [originalCredentials] = await db
        .select()
        .from(schema.certifierCredentials)
        .where(credentialsWhere)
        .limit(1);
      let importedTypeId: string | null = null;
      let mapping: Awaited<ReturnType<typeof seedCertifierMapping>> | null =
        null;
      let browserContext: BrowserContext | null = null;
      const userId = `e2e-feedstock-import-admin-${crypto.randomUUID()}`;
      const userEmail = `${userId}@e2e.local`;
      const userPassword = "TestPassword123!";

      try {
        const existingTypes = await db
          .select({
            name: schema.feedstockTypes.name,
            isometricId: schema.feedstockTypes.isometricFeedstockTypeId,
          })
          .from(schema.feedstockTypes)
          .where(eq(schema.feedstockTypes.organizationId, DEC_ORG_ID));
        const existingNames = new Set(existingTypes.map((type) => type.name));
        const existingIsometricIds = new Set(
          existingTypes.flatMap((type) =>
            type.isometricId ? [type.isometricId] : [],
          ),
        );
        const linkedEntry = catalogue.find((entry) =>
          existingIsometricIds.has(entry.id),
        );
        const seedableEntry = catalogue.find(
          (entry) =>
            !existingNames.has(entry.name) &&
            !existingIsometricIds.has(entry.id),
        );
        const importedEntry = linkedEntry ?? seedableEntry;
        test.skip(
          !importedEntry,
          "The local catalogue needs a linked or seedable Isometric entry.",
        );
        if (!importedEntry) return;

        await db
          .insert(schema.certifierCredentials)
          .values({
            organizationId: DEC_ORG_ID,
            provider: "isometric",
            accessTokenEncrypted: encryptSecret(ACCESS_TOKEN!),
            clientSecretEncrypted: encryptSecret(CLIENT_SECRET!),
          })
          .onConflictDoUpdate({
            target: [
              schema.certifierCredentials.organizationId,
              schema.certifierCredentials.provider,
            ],
            set: {
              accessTokenEncrypted: encryptSecret(ACCESS_TOKEN!),
              clientSecretEncrypted: encryptSecret(CLIENT_SECRET!),
              updatedAt: new Date(),
            },
          });

        if (!linkedEntry) {
          const [importedType] = await db
            .insert(schema.feedstockTypes)
            .values({
              organizationId: DEC_ORG_ID,
              code: `E2E-ISO-${crypto.randomUUID().slice(0, 8)}`,
              name: importedEntry.name,
              category: "forestry",
              usage: "pyrolysis",
              isometricFeedstockTypeId: importedEntry.id,
            })
            .returning({ id: schema.feedstockTypes.id });
          importedTypeId = importedType.id;
        }

        mapping = await seedCertifierMapping(seededData.facility.id, {
          externalProjectId:
            SANDBOX_PROJECT_ID ?? "e2e-feedstock-import-project",
        });

        await db.insert(schema.users).values({
          id: userId,
          email: userEmail,
          name: "E2E Feedstock Import Admin",
          emailVerified: true,
          role: "admin",
        });
        await db.insert(schema.accounts).values({
          id: `e2e-feedstock-import-account-${crypto.randomUUID()}`,
          userId,
          accountId: userId,
          providerId: "credential",
          password: await hashPassword(userPassword),
        });
        browserContext = await browser.newContext();
        const signInResponse = await browserContext.request.post(
          `${baseURL}/api/auth/sign-in/email`,
          {
            data: { email: userEmail, password: userPassword },
            headers: {
              Origin: baseURL!,
              "X-Forwarded-For": "192.0.2.42",
            },
          },
        );
        expect(signInResponse.ok()).toBe(true);
        const page = await browserContext.newPage();

        await page.goto(
          `/feedstock-types?facility=${seededData.facility.id}`,
        );
        await page
          .getByRole("button", { name: "Import from Isometric" })
          .click();

        const dialog = page.getByRole("dialog", {
          name: "Import from Isometric",
        });
        await expect(dialog).toBeVisible();

        const importedOption = page.getByTestId(
          `isometric-feedstock-option-${importedEntry.id}`,
        );
        await expect(importedOption).toBeDisabled();
        await expect(importedOption).toContainText("Imported");

        await expect(
          dialog.getByText("An unexpected error occurred", { exact: false }),
        ).toHaveCount(0);
      } finally {
        await browserContext?.close().catch(() => undefined);
        if (mapping) await mapping.cleanup();
        if (importedTypeId) {
          await db
            .delete(schema.feedstockTypes)
            .where(eq(schema.feedstockTypes.id, importedTypeId));
        }
        if (originalCredentials) {
          await db
            .update(schema.certifierCredentials)
            .set({
              accessTokenEncrypted:
                originalCredentials.accessTokenEncrypted,
              clientSecretEncrypted:
                originalCredentials.clientSecretEncrypted,
              updatedAt: originalCredentials.updatedAt,
            })
            .where(credentialsWhere);
        } else {
          await db
            .delete(schema.certifierCredentials)
            .where(credentialsWhere);
        }
        await db
          .delete(schema.sessions)
          .where(eq(schema.sessions.userId, userId));
        await db
          .delete(schema.accounts)
          .where(eq(schema.accounts.userId, userId));
        await db.delete(schema.users).where(eq(schema.users.id, userId));
        await pool.end();
      }
    });
  },
);
