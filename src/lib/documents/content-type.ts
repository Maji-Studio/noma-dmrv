const GENERIC_BINARY_CONTENT_TYPE = "application/octet-stream";

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  csv: "text/csv",
  // Browsers report an empty type for .geojson, which would otherwise resolve
  // to the generic binary type and fail the gis_boundary upload allow list.
  geojson: "application/geo+json",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
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
