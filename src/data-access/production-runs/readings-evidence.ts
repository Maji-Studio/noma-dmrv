import {
  and,
  eq,
  exists,
  ilike,
  inArray,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "../utils";
import { PRODUCTION_READINGS_CSV_MIMES } from "@/schemas/documents";

const PRODUCTION_RUN_ENTITY_TYPE = "production_run";
const READINGS_DOCUMENT_TYPE = "sensor_data";
const UPLOADED_DOCUMENT_STATUS = "uploaded";

/**
 * Organization-scoped saved fact used by every production-run certification
 * readiness surface. Pending and failed upload rows deliberately do not count.
 */
export function hasUploadedProductionReadingsFile(
  ctx: OrgContext,
  productionRunId: SQLWrapper,
): SQL<boolean> {
  requireOrgScope(ctx);

  return exists(
    db
      .select({ value: sql`1` })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, ctx.organizationId),
          eq(documents.entityType, PRODUCTION_RUN_ENTITY_TYPE),
          eq(documents.entityId, productionRunId),
          eq(documents.documentType, READINGS_DOCUMENT_TYPE),
          eq(documents.uploadStatus, UPLOADED_DOCUMENT_STATUS),
          ilike(documents.fileName, "%.csv"),
          inArray(
            sql`lower(split_part(${documents.mimeType}, ';', 1))`,
            [...PRODUCTION_READINGS_CSV_MIMES],
          ),
        ),
      ),
  ).mapWith(Boolean);
}
