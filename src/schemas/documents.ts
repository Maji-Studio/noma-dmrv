import { z } from "zod";
import { BYTES_PER_MB } from "@/lib/format-utils";
import {
  APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPES,
  APPLICATION_VISUAL_EVIDENCE_ROLES,
} from "@/lib/certification/application-evidence";

export const DOCUMENT_TYPES = [
  "weighbridge_ticket",
  "bill_of_lading",
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
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

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

const MB = BYTES_PER_MB;

const IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const VIDEO_MIMES = ["video/mp4", "video/webm"];
const PDF_MIMES = ["application/pdf"];
const TABULAR_MIMES = [
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

interface UploadRule {
  maxBytes: number;
  mimeTypes: readonly string[];
}

export const UPLOAD_RULES: Record<DocumentType, UploadRule> = {
  weighbridge_ticket: { maxBytes: 25 * MB, mimeTypes: [...PDF_MIMES, ...IMAGE_MIMES] },
  bill_of_lading: { maxBytes: 25 * MB, mimeTypes: [...PDF_MIMES, ...IMAGE_MIMES] },
  lab_report: { maxBytes: 50 * MB, mimeTypes: [...PDF_MIMES, ...IMAGE_MIMES, ...TABULAR_MIMES] },
  delivery_receipt: { maxBytes: 25 * MB, mimeTypes: [...PDF_MIMES, ...IMAGE_MIMES] },
  invoice: { maxBytes: 25 * MB, mimeTypes: [...PDF_MIMES] },
  pdd: { maxBytes: 50 * MB, mimeTypes: [...PDF_MIMES] },
  affidavit: { maxBytes: 25 * MB, mimeTypes: [...PDF_MIMES] },
  calibration_certificate: { maxBytes: 25 * MB, mimeTypes: [...PDF_MIMES, ...IMAGE_MIMES] },
  photo: { maxBytes: 25 * MB, mimeTypes: IMAGE_MIMES },
  video: { maxBytes: 100 * MB, mimeTypes: VIDEO_MIMES },
  pdf: { maxBytes: 50 * MB, mimeTypes: PDF_MIMES },
  sensor_data: { maxBytes: 25 * MB, mimeTypes: TABULAR_MIMES },
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
    contentType: z.string().min(1).max(255),
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
