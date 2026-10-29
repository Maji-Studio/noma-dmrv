"use server";
import { z } from "zod";
import { getRecordCertificationLock } from "@/data-access/record-certification-lock";
import { DOCUMENT_ENTITY_TYPES, type DocumentEntityType } from "@/schemas/documents";
import { withAction } from "./with-action";

const recordCertificationLockSchema = z.object({
  entityType: z.enum(DOCUMENT_ENTITY_TYPES),
  entityId: z.uuid(),
  scope: z.literal("transport").optional(),
});

export async function loadRecordCertificationLock(entityType: DocumentEntityType, entityId: string, scope?: "transport") {
  return withAction((ctx) => getRecordCertificationLock(ctx, recordCertificationLockSchema.parse({ entityType, entityId, scope })));
}
