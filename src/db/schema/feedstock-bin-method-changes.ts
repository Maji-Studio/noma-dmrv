import { foreignKey, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations, users } from './auth';
import { outputDrawOrder, outputStockMode } from './common';
import { storageLocations } from './facilities';

export const feedstockBinMethodChanges = pgTable('feedstock_bin_method_changes', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  storageLocationId: uuid('storage_location_id').notNull(),
  stockMode: outputStockMode('stock_mode').notNull(),
  drawOrder: outputDrawOrder('draw_order').notNull(),
  previousStockMode: outputStockMode('previous_stock_mode').notNull(),
  previousDrawOrder: outputDrawOrder('previous_draw_order').notNull(),
  effectiveAt: timestamp('effective_at').notNull(),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, table => [
  foreignKey({ columns: [table.storageLocationId, table.organizationId], foreignColumns: [storageLocations.id, storageLocations.organizationId] }),
  index('feedstock_bin_method_changes_bin_idx').on(table.organizationId, table.storageLocationId, table.effectiveAt),
]);
