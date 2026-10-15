/**
 * Organization operating defaults.
 *
 * These are the facts an operator re-types on every record because the codebase
 * had nowhere to put them: the country and timezone they work in, how they
 * evidence an application, and how they ship.
 *
 * Deliberately NOT here: anything protocol-derived. A settings row that could
 * move `SOIL_TEMPERATURE_FLOOR_C`, the Woolf/Sanei durability coefficients, the
 * H:C eligibility ceiling, or `METHOD_B_MINIMUM_METHOD_A_SAMPLES` would let an
 * operator weaken a certification gate from a form. Those stay constants; see
 * `docs/archive/plans/2026-07-28-admin-settings-ia-research.md` for the full triage.
 *
 * Every column except `default_timezone` is NOT NULL with a default matching
 * the literal it replaces, and `DEFAULT_ORGANIZATION_SETTINGS`
 * (`@/config/organization-settings`) mirrors them for organizations with no row
 * yet. `default_timezone` is nullable with no default: null means the
 * organization has not chosen a zone, so none is assumed.
 *
 * One row per organization — the unique index is what makes the upsert an
 * upsert.
 */
import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./auth";
import {
  applicationEvidenceMethod,
  packagingType,
} from "./common";

export const organizationSettings = pgTable(
  "organization_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),

    /**
     * Nullable on purpose: most organizations work in one country, but "we have
     * not said" is a real state. Facility and party locations require an
     * explicitly supplied country instead.
     */
    defaultCountry: text("default_country"),
    /** IANA zone. Wrong values silently shift sampling-day attribution. */
    defaultTimezone: text("default_timezone"),
    defaultEvidenceMethod: applicationEvidenceMethod("default_evidence_method")
      .notNull()
      .default("location"),
    defaultPackaging: packagingType("default_packaging")
      .notNull()
      .default("loose"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("organization_settings_organization_id_unique").on(
      table.organizationId,
    ),
  ],
);

export type OrganizationSettingsRow = typeof organizationSettings.$inferSelect;
