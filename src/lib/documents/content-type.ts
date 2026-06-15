const GENERIC_BINARY_CONTENT_TYPE = "application/octet-stream";

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  csv: "text/csv",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  mp4: "video/mp4",
  pdf: "application/pdf",
  png: "image/png",
  webm: "video/webm",
  webp: "image/webp",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function resolveUploadContentType(input: {
  fileName: string;
  contentType?: string | null;
}): string {
  const normalized = input.contentType?.split(";")[0]?.trim().toLowerCase();
  if (normalized && normalized !== GENERIC_BINARY_CONTENT_TYPE) {
    return normalized;
  }

  const extension = input.fileName.split(".").pop()?.toLowerCase();
  if (extension && EXTENSION_CONTENT_TYPES[extension]) {
    return EXTENSION_CONTENT_TYPES[extension];
  }

  return normalized || GENERIC_BINARY_CONTENT_TYPE;
}
