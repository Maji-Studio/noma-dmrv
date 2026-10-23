/** Saved document criteria shared by the lab-report chip and evidence queries. */
export const LAB_REPORT_DOCUMENT_CRITERIA = {
  uploadStatus: "uploaded",
  documentType: "lab_report",
} as const;

/** An uploaded Sample document that is a lab report: what the lab-report CERT chip counts. */
export function isLabReportDocument(document: {
  uploadStatus: string;
  documentType: string;
}): boolean {
  return document.uploadStatus === LAB_REPORT_DOCUMENT_CRITERIA.uploadStatus
    && document.documentType === LAB_REPORT_DOCUMENT_CRITERIA.documentType;
}
