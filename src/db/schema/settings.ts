/**
 * Organization operating defaults.
 *
 * These are the facts an operator re-types on every record because the codebase
 * had nowhere to put them: the currency they trade in, the country and timezone
 * they work in, whether their hauls are round trips, how they evidence an
 * application, how they ship. Each was a hardcoded literal repeated in three to
 * five places — `'TZS'` in five files, `'UTC'` in three — which is a
 * multi-tenant app encoding one tenant's habits as physics.
 *
 * Deliberately NOT here: anything protocol-derived. A settings row that could
 * move `SOIL_TEMPERATURE_FLOOR_C`, the Woolf/Sanei durability coefficients, the
 * H:C eligibility ceiling, or `METHOD_B_MINIMUM_METHOD_A_SAMPLES` would let an
 * operator weaken a certification gate from a form. Those stay constants; see
 * `docs/archive/plans/2026-07-28-admin-settings-ia-research.md` for the full triage.
 *
 * Every column is NOT NULL with a default matching the literal it replaces, and
 * `DEFAULT_ORGANIZATION_SETTINGS` (`@/config/organization-settings`) mirrors
 * them for organizations with no row yet. A read never returns null, so no
 * consumer has to decide what a missing default means.
 *
 * One row per organization — the unique index is what makes the upsert an
 * upsert.
 */
import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./auth";
import {
  applicationEvidenceMethod,
  packagingType,
  transportTripType,
} from "./common";

export const organizationSettings = pgTable(
  "organization_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),

    /** ISO 4217. Text, not an enum, matching `orders.currency`. */
    defaultCurrency: text("default_currency").notNull().default("TZS"),
    /**
     * Nullable on purpose: most organizations work in one country, but "we have
     * not said" is a real state, and it is not the same as the `'UNKNOWN'` that
     * facility and party rows persist today.
     */
    defaultCountry: text("default_country"),
    /** IANA zone. Wrong values silently shift sampling-day attribution. */
    defaultTimezone: text("default_timezone").notNull().default("UTC"),
    /** Conservative protocol default; the per-leg field stays editable. */
    defaultTripType: transportTripType("default_trip_type")
      .notNull()
      .default("return"),
    defaultEvidenceMethod: applicationEvidenceMethod("default_evidence_method")
      .notNull()
      .default("visual"),
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
