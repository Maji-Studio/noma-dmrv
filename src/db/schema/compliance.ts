import { relations, sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { facilities } from './facilities';
import { organizations } from './auth';

// ============================================
// Stockpile Events - Compliance/duration tracking for stockpiling controls
// Isometric Protocol: P0-07 stockpiling controls (§7)
// Tracks when material starts/ends stockpiling. Quantity tracked separately in biochar_storage_inventory.
// DB enforces: >12-month stockpile requires an exception approval reference.
// ============================================

export const stockpileEvents = pgTable(
  'stockpile_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    facilityId: uuid('facility_id')
      .notNull(),
    materialType: text('material_type').notNull(), // biochar | feedstock
    materialId: uuid('material_id').notNull(),
    startedAt: timestamp('started_at').notNull(),
    endedAt: timestamp('ended_at'), // null = still stockpiling
    lastControlAt: timestamp('last_control_at'),
    riskLevel: text('risk_level').notNull().default('low'), // low | medium | high
    mitigationNotes: text('mitigation_notes'),
    exceptionRef: text('exception_ref'), // required when stockpile exceeds 12 months
    documentRef: text('document_ref'),
    // Stamped by the facility archive cascade; NULL = active
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('stockpile_events_organization_id_idx').on(table.organizationId),
    foreignKey({
      columns: [table.facilityId, table.organizationId],
      foreignColumns: [facilities.id, facilities.organizationId],
    }),
    check(
      'stockpile_events_dates_check',
      sql`${table.endedAt} is null or ${table.endedAt} > ${table.startedAt}`
    ),
    check(
      'stockpile_events_material_type_check',
      sql`${table.materialType} in ('biochar', 'feedstock')`
    ),
    check(
      'stockpile_events_risk_level_check',
      sql`${table.riskLevel} in ('low', 'medium', 'high')`
    ),
    check(
      'stockpile_events_exception_ref_required',
      sql`${table.endedAt} is null
        or ${table.endedAt} <= ${table.startedAt} + interval '12 months'
        or ${table.exceptionRef} is not null`
    ),
  ]
);

// ============================================
// Power Procurement Evidence - EC1-EC5 low-carbon electricity evidence
// Isometric Protocol: P0-11, Energy Use Accounting Module §5.3
// Keyed to facility + reporting period. Stores hard-to-derive regulatory facts only.
// Pass/fail per EC category is derived by app logic from the stored fields.
// ============================================

export const powerProcurementEvidence = pgTable(
  'power_procurement_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    facilityId: uuid('facility_id')
      .notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    contractType: text('contract_type'), // PPA | EAC | direct | grid
    generatorCodDate: date('generator_cod_date'), // Commercial Operation Date (EC4 criterion)
    gridRegion: text('grid_region'),
    matchingType: text('matching_type'), // hourly | annual | none
    eacRegistry: text('eac_registry'),
    eacRetirementId: text('eac_retirement_id'),
    retiredAt: timestamp('retired_at'),
    documentRef: text('document_ref'),
    notes: text('notes'),
    // Stamped by the facility archive cascade; NULL = active
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('power_procurement_evidence_organization_id_idx').on(table.organizationId),
    foreignKey({
      columns: [table.facilityId, table.organizationId],
      foreignColumns: [facilities.id, facilities.organizationId],
    }),
    unique('power_procurement_evidence_facility_period_unique').on(
      table.facilityId,
      table.periodStart,
      table.periodEnd
    ),
    check(
      'power_procurement_evidence_period_check',
      sql`${table.periodStart} < ${table.periodEnd}`
    ),
  ]
);

export const stockpileEventsRelations = relations(stockpileEvents, ({ one }) => ({
  facility: one(facilities, {
    fields: [stockpileEvents.facilityId],
    references: [facilities.id],
  }),
}));

export const powerProcurementEvidenceRelations = relations(
  powerProcurementEvidence,
  ({ one }) => ({
    facility: one(facilities, {
      fields: [powerProcurementEvidence.facilityId],
      references: [facilities.id],
    }),
  })
);
