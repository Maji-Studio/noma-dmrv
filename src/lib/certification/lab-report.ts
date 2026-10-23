/** An uploaded Sample document that is a lab report: what the lab-report CERT chip counts. */
export function isLabReportDocument(document: {
  uploadStatus: string;
  documentType: string;
}): boolean {
  return document.uploadStatus === "uploaded" && document.documentType === "lab_report";
}
