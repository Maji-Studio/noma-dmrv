import { insertRemovalFixture } from "./removal-fixture";
import { apiActivityWhere } from "./api-activity";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, apiIdempotencyRecords, applications, certificationSubmissions, certifierRemovals, creditBatchApplications, creditBatchProductionRuns, creditBatches, documents, feedstocks, productionProcesses, samples } from "@/db/schema";
import { createApiKey } from "@/data-access/api-keys";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { API_DOCUMENT_OWNERS, type ApiDocumentOwnerType } from "@/lib/documents/api-owners";
import { POST as feedstockRequest } from "@/app/api/v1/feedstocks/[idOrCode]/documents/route";
import { POST as feedstockConfirm } from "@/app/api/v1/feedstocks/[idOrCode]/documents/[documentId]/confirm/route";
import { POST as deliveryRequest } from "@/app/api/v1/deliveries/[idOrCode]/documents/route";
import { POST as deliveryConfirm } from "@/app/api/v1/deliveries/[idOrCode]/documents/[documentId]/confirm/route";
import { POST as sampleRequest } from "@/app/api/v1/lab-samples/[idOrCode]/documents/route";
import { POST as sampleConfirm } from "@/app/api/v1/lab-samples/[idOrCode]/documents/[documentId]/confirm/route";
import { POST as applicationRequest } from "@/app/api/v1/applications/[idOrCode]/documents/route";
import { POST as applicationConfirm } from "@/app/api/v1/applications/[idOrCode]/documents/[documentId]/confirm/route";
import { createApiOrderReadFixture, insertReadDelivery, insertReadOrder, removeApiOrderReadFixture } from "./api-order-read-fixture";

export const DOCUMENT_BYTES = Buffer.from("%PDF-1.7");
export const DOCUMENT_SHA256 = createHash("sha256").update(DOCUMENT_BYTES).digest("hex");
const SAMPLE_TOTAL_CARBON_PERCENT = 80;
const SAMPLE_ORGANIC_CARBON_PERCENT = 78;
const DELIVERY_KG = 10;
const routes = {
  feedstock: { request: feedstockRequest, confirm: feedstockConfirm },
  delivery: { request: deliveryRequest, confirm: deliveryConfirm },
  lab_sample: { request: sampleRequest, confirm: sampleConfirm },
  application: { request: applicationRequest, confirm: applicationConfirm },
};
export async function createApiDocumentWriteFixture() {
  const f = await createApiOrderReadFixture();
  const credential = await createApiKey(f.ctx, { name: "Document writes", expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS,
    scopes: ["feedstocks:read", "feedstocks:write", "feedstocks:delete", "deliveries:read", "deliveries:write", "lab-samples:read", "lab-samples:write", "applications:read", "applications:write"] });
  const [feedstock] = await db.select().from(feedstocks).where(eq(feedstocks.organizationId, f.ctx.organizationId));
  const order = await insertReadOrder(f, `OR-DOC-${f.tag}`);
  const delivery = await insertReadDelivery(f, order.id, DELIVERY_KG);
  const [application] = await db.insert(applications).values({ organizationId: f.ctx.organizationId, code: `AP-DOC-BASE-${f.tag}`,
    deliveryId: delivery.id, applicationDate: new Date("2026-09-16T00:00:00Z"), biocharAppliedTons: 0.001,
    biocharAppliedDryTons: 0.001, fieldSizeHa: 1, gpsLatitude: 0, gpsLongitude: 0 }).returning();
  const [process] = await db.insert(productionProcesses).values({ organizationId: f.ctx.organizationId,
    facilityId: f.facility.id, feedstockTypeId: feedstock.feedstockTypeId }).returning();
  const [batch] = await db.insert(creditBatches).values({ organizationId: f.ctx.organizationId, facilityId: f.facility.id,
    code: `CB-DOC-${f.tag}`, feedstockTypeId: feedstock.feedstockTypeId, productionProcessId: process.id,
    startDate: "2026-09-01", endDate: "2026-09-30" }).returning();
  const [sample] = await db.insert(samples).values({ organizationId: f.ctx.organizationId, creditBatchId: batch.id,
    sampleCode: `LS-DOC-${f.tag}`, samplingTime: new Date("2026-09-15T12:00:00Z"),
    totalCarbonPercent: SAMPLE_TOTAL_CARBON_PERCENT, organicCarbonPercent: SAMPLE_ORGANIC_CARBON_PERCENT }).returning();
  return { ...f, writeKey: credential.key, credentialId: credential.id, batch,
    owners: { feedstock, delivery, application, lab_sample: { ...sample, code: sample.sampleCode } } };
}
export type ApiDocumentWriteFixture = Awaited<ReturnType<typeof createApiDocumentWriteFixture>>;
export async function removeApiDocumentWriteFixture(f: ApiDocumentWriteFixture) {
  await db.delete(certificationSubmissions).where(eq(certificationSubmissions.organizationId, f.ctx.organizationId));
  await db.delete(creditBatchApplications).where(eq(creditBatchApplications.organizationId, f.ctx.organizationId));
  await db.delete(applications).where(eq(applications.organizationId, f.ctx.organizationId));
  await db.delete(certifierRemovals).where(eq(certifierRemovals.organizationId, f.ctx.organizationId));
  await db.delete(samples).where(eq(samples.organizationId, f.ctx.organizationId));
  await db.delete(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.organizationId, f.ctx.organizationId));
  await db.delete(creditBatches).where(eq(creditBatches.organizationId, f.ctx.organizationId));
  await db.delete(productionProcesses).where(eq(productionProcesses.organizationId, f.ctx.organizationId));
  await removeApiOrderReadFixture(f);
}
export async function submitDocumentDelivery(f: ApiDocumentWriteFixture, applicationId?: string) {
  const organizationId = f.ctx.organizationId;
  await db.insert(creditBatchProductionRuns).values({ organizationId, creditBatchId: f.batch.id, productionRunId: f.runs[0].id });
  const application = applicationId ? { id: applicationId } : (await db.insert(applications).values({ organizationId, code: `AP-DOC-${f.tag}`, deliveryId: f.owners.delivery.id,
    applicationDate: new Date("2026-09-16T00:00:00Z"), biocharAppliedTons: 0.01, biocharAppliedDryTons: 0.01,
    fieldSizeHa: 1, gpsLatitude: 0, gpsLongitude: 0 }).returning())[0];
  const [removal] = await insertRemovalFixture(db, { organizationId, facilityId: f.facility.id });
  await db.insert(creditBatchApplications).values({ organizationId, creditBatchId: f.batch.id, applicationId: application.id,
    allocatedWetMassKg: DELIVERY_KG, allocatedDryMassKg: DELIVERY_KG, removalId: removal.id });
  await db.insert(certificationSubmissions).values({ organizationId, provider: "isometric", submissionType: "removal", localEntityType: "removal",
    localEntityId: removal.id, version: 1, status: "submitted", payloadHash: randomUUID(), payloadSnapshot: {} });
}
export function documentInput(owner: ApiDocumentOwnerType = "delivery", extra: Record<string, unknown> = {}) {
  return { documentType: owner === "application" ? "pdf" : API_DOCUMENT_OWNERS[owner].documentTypes[0], fileName: "receipt.pdf", contentType: "application/pdf",
    sizeBytes: DOCUMENT_BYTES.length, sha256: DOCUMENT_SHA256, ...extra };
}
type CallOptions = { id?: string; documentId?: string; key?: string | null; credential?: string; query?: string; headers?: Record<string, string>; body?: unknown };
export function callDocumentWrite(f: ApiDocumentWriteFixture, owner: ApiDocumentOwnerType, kind: "request" | "confirm", options: CallOptions = {}) {
  const idOrCode = options.id ?? f.owners[owner].id;
  const suffix = kind === "confirm" ? `/${options.documentId}/confirm` : "";
  const headers = new Headers({ authorization: `Bearer ${options.credential ?? f.writeKey}`, ...options.headers });
  const key = options.key === undefined && kind === "request" ? randomUUID() : options.key;
  if (key != null) headers.set("Idempotency-Key", key);
  const body = Object.hasOwn(options, "body") ? options.body : kind === "request" ? documentInput(owner) : undefined;
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const request = new Request(`http://localhost:3100/api/v1/${API_DOCUMENT_OWNERS[owner].path}/${idOrCode}/documents${suffix}${options.query ?? ""}`, {
    method: "POST", headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return routes[owner][kind](request, { params: Promise.resolve({ idOrCode, documentId: options.documentId! }) });
}
export const documentRows = (f: ApiDocumentWriteFixture) => db.select().from(documents).where(eq(documents.organizationId, f.ctx.organizationId));
export const documentRecords = (f: ApiDocumentWriteFixture) => db.select().from(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, f.ctx.organizationId));
export const documentAudits = (f: ApiDocumentWriteFixture) => db.select().from(activityEvents).where(apiActivityWhere(f.ctx.organizationId, eq(activityEvents.credentialId, f.credentialId)));
