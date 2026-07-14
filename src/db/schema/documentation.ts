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
import {
  documentationType,
  documentVisibility,
  documentUploadStatus,
} from './common';
import { organizations, users } from './auth';

// Optional file-based evidence linked via polymorphic entity references.
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    documentType: documentationType('document_type').notNull(),

    // Where the object lives. storage_* fields are set together for uploaded
    // objects; file_url alone is set for external/legacy URLs (e.g. Isometric
    // registry page links).
    storageProvider: text('storage_provider'),
    storageBucket: text('storage_bucket'),
    storageKey: text('storage_key'),
    fileUrl: text('file_url'),

    fileName: text('file_name').notNull(),
    fileSizeBytes: integer('file_size_bytes'),
    mimeType: text('mime_type'),
    checksumSha256: text('checksum_sha256'),

    visibility: documentVisibility('visibility').notNull().default('private'),
    uploadStatus: documentUploadStatus('upload_status')
      .notNull()
      .default('uploaded'),

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
    index('documents_organization_id_idx').on(table.organizationId),
    // Every row must point to something: a storage object OR an external URL.
    check(
      'documents_resolvable',
      sql`${table.storageKey} is not null or ${table.fileUrl} is not null`
    ),
    // If storage_key is set, the rest of the storage triple must be too.
    check(
      'documents_storage_fields_cohere',
      sql`${table.storageKey} is null or (${table.storageProvider} is not null and ${table.storageBucket} is not null)`
    ),
    // Can't be "waiting on an upload" without a key to wait on.
    check(
      'documents_pending_requires_storage_key',
      sql`${table.uploadStatus} <> 'pending' or ${table.storageKey} is not null`
    ),
    index('documents_entity_type_entity_id_idx').on(table.entityType, table.entityId),
    index('documents_document_type_idx').on(table.documentType),
  ]
);
