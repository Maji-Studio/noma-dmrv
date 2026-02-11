import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  integer,
  check,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { documentationType } from './common';
import { users } from './auth';

// Optional file-based evidence linked via polymorphic entity references.
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    documentType: documentationType('document_type').notNull(),

    fileUrl: text('file_url').notNull(),
    fileName: text('file_name').notNull(),
    fileSizeBytes: integer('file_size_bytes'),
    mimeType: text('mime_type'),
    checksumSha256: text('checksum_sha256'),

    issuedAt: timestamp('issued_at'),
    capturedAt: timestamp('captured_at'),
    description: text('description'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdBy: text('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    notes: text('notes'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'documents_photo_video_require_captured_at',
      sql`${table.documentType} <> all (array['photo', 'video']::documentation_type[]) or ${table.capturedAt} is not null`
    ),
    index('documents_entity_type_entity_id_idx').on(table.entityType, table.entityId),
    index('documents_document_type_idx').on(table.documentType),
  ]
);
