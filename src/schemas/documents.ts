import { z } from "zod";
import {
  APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPES,
  APPLICATION_VISUAL_EVIDENCE_ROLES,
} from "@/lib/certification/application-evidence";
import { DOCUMENT_UPLOAD_MAX_BYTES } from "@/lib/documents/upload-policy";

export const DOCUMENT_TYPES = [
  "weighbridge_ticket",
  "bill_of_lading",
  "other_transport_evidence",
  "lab_report",
  "delivery_receipt",
  "invoice",
  "pdd",
  "affidavit",
  "calibration_certificate",
  "photo",
  "video",
  "pdf",
  "sensor_data",
  "gis_boundary",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  weighbridge_ticket: "Weighbridge ticket",
  bill_of_lading: "Bill of lading",
  other_transport_evidence: "Other transport evidence",
  lab_report: "Lab report",
  delivery_receipt: "Delivery receipt",
  invoice: "Invoice",
  pdd: "PDD",
  affidavit: "Affidavit",
  calibration_certificate: "Calibration certificate",
  photo: "Photo",
  video: "Video",
  pdf: "PDF",
  sensor_data: "Sensor data",
  gis_boundary: "GIS boundary",
};

export const DOCUMENT_VISIBILITIES = ["private", "public"] as const;
export type DocumentVisibility = (typeof DOCUMENT_VISIBILITIES)[number];

export const DOCUMENT_ENTITY_TYPES = [
  "sample",
  "delivery",
  "production_run",
  "production_incident",
  "production_sample",
  "biochar_product",
  "feedstock",
  "feedstock_delivery",
  "application",
  "credit_batch",
  "facility",
  "reactor",
  "order",
  "transport_leg",
] as const;
export type DocumentEntityType = (typeof DOCUMENT_ENTITY_TYPES)[number];

const IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const VIDEO_MIMES = ["video/mp4", "video/webm"];
const PDF_MIMES = ["application/pdf"];
const TABULAR_MIMES = [
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
const GEOJSON_MIMES = [
  "application/geo+json",
  "application/json",
  "text/plain",
  "",
];

interface UploadRule {
  maxBytes: number;
  mimeTypes: readonly string[];
}

function uploadRule(mimeTypes: readonly string[]): UploadRule {
  return { maxBytes: DOCUMENT_UPLOAD_MAX_BYTES, mimeTypes };
}

export const UPLOAD_RULES: Record<DocumentType, UploadRule> = {
  weighbridge_ticket: uploadRule([...PDF_MIMES, ...IMAGE_MIMES]),
  bill_of_lading: uploadRule([...PDF_MIMES, ...IMAGE_MIMES]),
  other_transport_evidence: uploadRule([...PDF_MIMES, ...IMAGE_MIMES]),
  lab_report: uploadRule([
    ...PDF_MIMES,
    ...IMAGE_MIMES,
    ...TABULAR_MIMES,
  ]),
  delivery_receipt: uploadRule([...PDF_MIMES, ...IMAGE_MIMES]),
  invoice: uploadRule(PDF_MIMES),
  pdd: uploadRule(PDF_MIMES),
  affidavit: uploadRule(PDF_MIMES),
  calibration_certificate: uploadRule([...PDF_MIMES, ...IMAGE_MIMES]),
  photo: uploadRule(IMAGE_MIMES),
  video: uploadRule(VIDEO_MIMES),
  pdf: uploadRule(PDF_MIMES),
  sensor_data: uploadRule(TABULAR_MIMES),
  gis_boundary: uploadRule(GEOJSON_MIMES),
};

export function isAllowedMime(
  documentType: DocumentType,
  contentType: string
): boolean {
  // Strip parameters (e.g. "application/pdf; charset=binary") before matching.
  const normalized = contentType.split(";")[0].trim().toLowerCase();
  return UPLOAD_RULES[documentType].mimeTypes.includes(normalized);
}

export function maxBytesFor(documentType: DocumentType): number {
  return UPLOAD_RULES[documentType].maxBytes;
}

export const requestUploadSchema = z
  .object({
    entityType: z.enum(DOCUMENT_ENTITY_TYPES),
    entityId: z.string().uuid(),
    documentType: z.enum(DOCUMENT_TYPES),
    fileName: z.string().min(1).max(255),
    contentType: z.string().max(255),
    sizeBytes: z.number().int().nonnegative(),
    capturedAt: z.iso.datetime().optional(),
    gpsLatitude: z.number().min(-90).max(90).optional(),
    gpsLongitude: z.number().min(-180).max(180).optional(),
    description: z.string().max(2000).optional(),
    applicationEvidenceRole: z
      .enum(APPLICATION_VISUAL_EVIDENCE_ROLES)
      .optional(),
    applicationLogbookEvidenceType: z
      .enum(APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPES)
      .optional(),
  })
  // Reject contradictory evidence classifications at the contract boundary, the
  // same rule updateApplicationEvidenceMetadata enforces on reclassification: a
  // visual role belongs only on a photo, a logbook type only on a logbook
  // document (typed PDF, weighbridge ticket, or affidavit).
  .superRefine((data, ctx) => {
    if (
      data.applicationEvidenceRole !== undefined &&
      data.documentType !== "photo"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["applicationEvidenceRole"],
        message: "Visual evidence role can only be set on photo uploads",
      });
    }
    if (
      data.applicationLogbookEvidenceType !== undefined &&
      data.documentType !== "pdf" &&
      data.documentType !== "weighbridge_ticket" &&
      data.documentType !== "affidavit"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["applicationLogbookEvidenceType"],
        message:
          "Boundary logbook evidence type can only be set on logbook documents",
      });
    }
  });
export type RequestUploadInput = z.infer<typeof requestUploadSchema>;

export const confirmUploadSchema = z.object({
  documentId: z.string().uuid(),
});

export const setVisibilitySchema = z.object({
  documentId: z.string().uuid(),
  visibility: z.enum(DOCUMENT_VISIBILITIES),
});

export const updateApplicationEvidenceMetadataSchema = z
  .object({
    documentId: z.string().uuid(),
    applicationEvidenceRole: z
      .enum(APPLICATION_VISUAL_EVIDENCE_ROLES)
      .optional(),
    applicationLogbookEvidenceType: z
      .enum(APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPES)
      .optional(),
  })
  .refine(
    (data) =>
      data.applicationEvidenceRole !== undefined ||
      data.applicationLogbookEvidenceType !== undefined,
    { message: "Choose an evidence classification" },
  );

export const deleteDocumentSchema = z.object({
  documentId: z.string().uuid(),
});
