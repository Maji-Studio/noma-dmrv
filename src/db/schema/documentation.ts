import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  integer,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { documentationType } from './common';
import { feedstocks, feedstockDeliveries } from './feedstock';
import { productionRuns, samples, incidentReports } from './production';
import { biocharProducts } from './products';
import { deliveries, transportLegs } from './logistics';
import { applications } from './application';
import { creditBatches, labAnalyses } from './credits';

// File-based evidence with explicit foreign keys instead of polymorphic references.
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentType: documentationType('document_type').notNull(),

    fileUrl: text('file_url').notNull(),
    fileName: text('file_name').notNull(),
    fileSizeBytes: integer('file_size_bytes'),
    mimeType: text('mime_type'),
    checksumSha256: text('checksum_sha256'),

    issuedAt: timestamp('issued_at'),
    capturedAt: timestamp('captured_at'),
    description: text('description'),
    metadata: jsonb('metadata'),
    createdBy: text('created_by'),
    notes: text('notes'),

    feedstockId: uuid('feedstock_id').references(() => feedstocks.id),
    feedstockDeliveryId: uuid('feedstock_delivery_id').references(
      () => feedstockDeliveries.id
    ),
    productionRunId: uuid('production_run_id').references(() => productionRuns.id),
    sampleId: uuid('sample_id').references(() => samples.id),
    incidentReportId: uuid('incident_report_id').references(
      () => incidentReports.id
    ),
    biocharProductId: uuid('biochar_product_id').references(
      () => biocharProducts.id
    ),
    deliveryId: uuid('delivery_id').references(() => deliveries.id),
    transportLegId: uuid('transport_leg_id').references(() => transportLegs.id),
    applicationId: uuid('application_id').references(() => applications.id),
    creditBatchId: uuid('credit_batch_id').references(() => creditBatches.id),
    labAnalysisId: uuid('lab_analysis_id').references(() => labAnalyses.id),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'documents_exactly_one_owner_check',
      sql`(
      (case when ${table.feedstockId} is not null then 1 else 0 end) +
      (case when ${table.feedstockDeliveryId} is not null then 1 else 0 end) +
      (case when ${table.productionRunId} is not null then 1 else 0 end) +
      (case when ${table.sampleId} is not null then 1 else 0 end) +
      (case when ${table.incidentReportId} is not null then 1 else 0 end) +
      (case when ${table.biocharProductId} is not null then 1 else 0 end) +
      (case when ${table.deliveryId} is not null then 1 else 0 end) +
      (case when ${table.transportLegId} is not null then 1 else 0 end) +
      (case when ${table.applicationId} is not null then 1 else 0 end) +
      (case when ${table.creditBatchId} is not null then 1 else 0 end) +
      (case when ${table.labAnalysisId} is not null then 1 else 0 end)
      ) = 1`
    ),
  ]
);
