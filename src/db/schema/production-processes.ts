import { index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { moisturePathway, samplingMethod } from './common';
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
// compute; Track 2 adds the explicit unlock + prerequisite capture.
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

    // The active sampling regime, MOVED OFF `reactors`. A process starts on
    // method_a and is flipped to method_b by the facility-manager unlock (ADR
    // 0017) once it clears its ≥30-sample baseline.
    samplingMethod: samplingMethod('sampling_method').notNull().default('method_a'),

    // Method-B unlock timestamp (ADR 0017). NULL = Method A enforced. When a
    // facility manager unlocks Method B for a process that has cleared its
    // ≥30-sample baseline, this is stamped (alongside flipping `samplingMethod`
    // and capturing the three prerequisites below); the Method-B compute
    // (cadence gate, unsampled estimate, eligible/borrow pool) reads the method
    // then. The app-layer unlock guard + a DB trigger backstop both reject a
    // flip before the baseline is met.
    methodBUnlockedAt: timestamp('method_b_unlocked_at'),

    // ── Method-B unlock prerequisites (ADR 0017, captured at unlock) ──────────
    // Three protocol prerequisites a sample count cannot infer. All NULL under
    // Method A; set together when Method B is unlocked. They record an
    // off-system Isometric agreement — noma stores the declarations, the
    // registry remains the authority for the credited compute (ADR 0013 / D1).

    // The Isometric-agreed Method-A baseline size (`G-F74T-0`; ≥30, default 30,
    // Isometric-negotiable). The DB trigger backstop enforces the hard ≥30 floor;
    // this records the specific number agreed for this process.
    agreedBaselineSize: integer('agreed_baseline_size'),

    // Reference to the random-sampling plan agreed with Isometric and documented
    // in the PDD (`R-S8K1-1`). A free-text note/document reference, not a strict
    // FK — the plan lives off-system in the PDD.
    randomSamplingPlanRef: text('random_sampling_plan_ref'),

    // The declared moisture-determination pathway (`R-ADXG-0`). noma defaults to
    // `measured_every_batch` (it already records per-run biochar moisture); the
    // SEM-monitored consistent-moisture pathway is recordable but unmonitored
    // (out of scope, D7).
    moisturePathway: moisturePathway('moisture_pathway'),

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
