import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { samplingMethod } from './common';
import { facilities } from './facilities';
import { feedstockTypes } from './feedstock';

// ============================================
// Production Processes - Sampling-regime campaigns
// Isometric Biochar Protocol §8.3.1 (production process / production batch)
//
// A production process is the campaign of biochar production sharing ONE
// feedstock under consistent pyrolysis conditions — the population a sampling
// regime characterises over time. Per the protocol it is keyed by
// (feedstock × conditions) and *spans reactors* (physical reactor identity is
// NOT part of its boundary). Because DEC's conditions are stable per feedstock,
// that key collapses, for noma, to (facility, feedstockType). Many monthly
// credit batches (= protocol production batches) belong to one process.
//
// It is REGISTRY-AGNOSTIC: a generic production campaign. The Isometric rules
// (≥30-sample Method-B baseline, the unsampled estimate, the 6-month borrow
// pool) are conditional gates applied only when the certifier is Isometric.
//
// Several processes may exist for the same (facility, feedstock) OVER TIME — a
// feedstock change, pyrolysis-condition change, or 3σ carbon deviation opens a
// NEW process and resets the baseline (`establishedAt`). The current process is
// the most recent one for the pair; the lookup index is therefore non-unique.
	// See ADR 0016. ADR 0017 Track 1 adds read-only Method-B baseline/cadence
	// compute; Track 2 adds the explicit unlock.
// ============================================

export const productionProcesses = pgTable(
  'production_processes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id),
    feedstockTypeId: uuid('feedstock_type_id')
      .notNull()
      .references(() => feedstockTypes.id),

		// Baseline epoch: when this process (and its sample-counting toward the
		// Method-B baseline) began. A new process resets it.
    establishedAt: timestamp('established_at').defaultNow().notNull(),

		// The active sampling regime, MOVED OFF `reactors`. DEC runs method_a
		// everywhere; method_b is reachable only via the Track 2 unlock.
    samplingMethod: samplingMethod('sampling_method').notNull().default('method_a'),

		// Conditional-gate seam for the Track 2 Method-B unlock (ADR 0017).
		// NULL = Method A enforced. When Method B is unlocked for a process that has
		// met its ≥30-sample baseline, this is stamped; the Method-B submission route
		// reads it then.
    methodBUnlockedAt: timestamp('method_b_unlocked_at'),

    notes: text('notes'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    // Lets credit_batches enforce that its productionProcessId belongs to the
    // same facility/feedstock pair as the batch itself.
    unique('production_processes_id_facility_feedstock_unique').on(
      table.id,
      table.facilityId,
      table.feedstockTypeId
    ),
    // Drives find-or-create + "current process for this (facility, feedstock)"
    // lookups. Non-unique by design (sequential processes per pair over time).
    index('production_processes_facility_feedstock_idx').on(
      table.facilityId,
      table.feedstockTypeId
    ),
  ]
);

// ============================================
// Relations
// ============================================
// One-directional (facility, feedstockType) only — the credit-batch side owns
// the process relation to avoid a circular schema import with credits.ts.

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

// ============================================
// Type Exports
// ============================================

export type ProductionProcess = typeof productionProcesses.$inferSelect;
export type NewProductionProcess = typeof productionProcesses.$inferInsert;
