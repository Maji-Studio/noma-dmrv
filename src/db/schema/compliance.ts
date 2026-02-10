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
