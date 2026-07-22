import { relations, sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { moisturePathway } from './common';
import { facilities } from './facilities';
import { feedstockTypes } from './feedstock';
import { organizations } from './auth';

// ============================================
// Production Processes - process epochs and Method-B prerequisites
// Isometric Biochar Protocol §8.3.1 (production process / production batch)
//
// A process is a period of consistent pyrolysis for one feedstock type at one
// facility. It spans reactors. A feedstock or condition change starts a new
// process and therefore a fresh `establishedAt` sample-counting epoch.
//
// No sampling regime or unlock state is stored here. Under ADR 0022, Method-B
// relevance is Isometric-gated and computed live from the current epoch, the
// three all-or-none prerequisites, and eligible samples. Each credit batch
// stores its own immutable sampled/unsampled choice.
// ============================================

export const productionProcesses = pgTable(
  'production_processes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    facilityId: uuid('facility_id').notNull(),
    feedstockTypeId: uuid('feedstock_type_id')
      .notNull()
      .references(() => feedstockTypes.id),

    establishedAt: timestamp('established_at').defaultNow().notNull(),

    // Off-system Isometric agreements a sample count cannot infer. These are
    // either all absent or all recorded together (ADR 0022).
    agreedBaselineSize: integer('agreed_baseline_size'),
    randomSamplingPlanRef: text('random_sampling_plan_ref'),
    moisturePathway: moisturePathway('moisture_pathway'),
    notes: text('notes'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('production_processes_organization_id_idx').on(table.organizationId),
    foreignKey({
      columns: [table.facilityId, table.organizationId],
      foreignColumns: [facilities.id, facilities.organizationId],
    }),
    unique('production_processes_id_facility_feedstock_unique').on(
      table.id,
      table.facilityId,
      table.feedstockTypeId
    ),
    index('production_processes_facility_feedstock_idx').on(
      table.facilityId,
      table.feedstockTypeId
    ),
    check(
      'production_processes_method_b_prereqs_chk',
      sql`(
        ${table.agreedBaselineSize} IS NULL
        AND ${table.randomSamplingPlanRef} IS NULL
        AND ${table.moisturePathway} IS NULL
      ) OR (
        ${table.agreedBaselineSize} IS NOT NULL
        AND ${table.randomSamplingPlanRef} IS NOT NULL
        AND btrim(${table.randomSamplingPlanRef}) <> ''
        AND ${table.moisturePathway} IS NOT NULL
      )`
    ),
  ]
);

export const productionProcessesRelations = relations(
  productionProcesses,
  ({ one }) => ({
    facility: one(facilities, {
      fields: [productionProcesses.facilityId],
      references: [facilities.id],
    }),
    feedstockType: one(feedstockTypes, {
      fields: [productionProcesses.feedstockTypeId],
      references: [feedstockTypes.id],
    }),
  })
);

export type ProductionProcess = typeof productionProcesses.$inferSelect;
export type NewProductionProcess = typeof productionProcesses.$inferInsert;
