import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { creditBatches } from './credits';
import { documents } from './documentation';
import { feedstocks } from './feedstock';
import { facilities } from './facilities';

// ============================================
// Feedstock Sustainability Criteria Assessments
// ============================================

export const feedstockScAssessments = pgTable(
  'feedstock_sc_assessments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    feedstockId: uuid('feedstock_id')
      .notNull()
      .references(() => feedstocks.id),
    criterionCode: text('criterion_code').notNull(),
    assessmentDate: date('assessment_date').notNull(),
    outcome: text('outcome').notNull(), // pass | fail | conditional
    assessor: text('assessor'),
    validFrom: date('valid_from'),
    validTo: date('valid_to'),
    evidenceDocumentId: uuid('evidence_document_id').references(
      () => documents.id
    ),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('feedstock_sc_assessments_feedstock_criterion_date_unique').on(
      table.feedstockId,
      table.criterionCode,
      table.assessmentDate
    ),
    check(
      'feedstock_sc_assessments_validity_window',
      sql`${table.validFrom} is null or ${table.validTo} is null or ${table.validFrom} <= ${table.validTo}`
    ),
  ]
);

// ============================================
// Custody Handoffs (Chain of Custody Ledger)
// ============================================

export const custodyHandoffs = pgTable('custody_handoffs', {
  id: uuid('id').primaryKey().defaultRandom(),
  materialType: text('material_type').notNull(), // feedstock | biochar | delivery | sample
  materialId: uuid('material_id').notNull(),
  fromPartyType: text('from_party_type').notNull(), // supplier | facility | transporter | customer
  fromPartyId: uuid('from_party_id'),
  toPartyType: text('to_party_type').notNull(),
  toPartyId: uuid('to_party_id'),
  handoffAt: timestamp('handoff_at').notNull(),
  quantityKg: real('quantity_kg'),
  referenceNumber: text('reference_number'),
  documentId: uuid('document_id').references(() => documents.id),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================
// GHG Materiality Assessments
// ============================================

export const ghgMaterialityAssessments = pgTable(
  'ghg_materiality_assessments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creditBatchId: uuid('credit_batch_id')
      .notNull()
      .references(() => creditBatches.id),
    assessmentDate: date('assessment_date').notNull(),
    estimatedSsrEmissionsTco2e: real('estimated_ssr_emissions_tco2e').notNull(),
    estimatedNetRemovalsTco2e: real('estimated_net_removals_tco2e').notNull(),
    materialityPercent: real('materiality_percent'),
    isMaterial: boolean('is_material'),
    reassessmentRequiredBy: date('reassessment_required_by'),
    methodologyReference: text('methodology_reference'),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'ghg_materiality_assessments_percent_range',
      sql`${table.materialityPercent} is null or (${table.materialityPercent} >= 0 and ${table.materialityPercent} <= 100)`
    ),
  ]
);

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
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id),
    materialType: text('material_type').notNull(), // biochar | feedstock
    materialId: uuid('material_id').notNull(),
    startedAt: timestamp('started_at').notNull(),
    endedAt: timestamp('ended_at'), // null = still stockpiling
    lastControlAt: timestamp('last_control_at'),
    riskLevel: text('risk_level').notNull().default('low'), // low | medium | high
    mitigationNotes: text('mitigation_notes'),
    exceptionRef: text('exception_ref'), // required when stockpile exceeds 12 months
    documentRef: text('document_ref'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
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
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id),
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
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
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

export const feedstockScAssessmentsRelations = relations(
  feedstockScAssessments,
  ({ one }) => ({
    feedstock: one(feedstocks, {
      fields: [feedstockScAssessments.feedstockId],
      references: [feedstocks.id],
    }),
    evidenceDocument: one(documents, {
      fields: [feedstockScAssessments.evidenceDocumentId],
      references: [documents.id],
    }),
  })
);

export const custodyHandoffsRelations = relations(custodyHandoffs, ({ one }) => ({
  document: one(documents, {
    fields: [custodyHandoffs.documentId],
    references: [documents.id],
  }),
}));

export const ghgMaterialityAssessmentsRelations = relations(
  ghgMaterialityAssessments,
  ({ one }) => ({
    creditBatch: one(creditBatches, {
      fields: [ghgMaterialityAssessments.creditBatchId],
      references: [creditBatches.id],
    }),
  })
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
