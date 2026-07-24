import { createHash } from "node:crypto";
import {
  createElement as h,
  type ComponentType,
  type ReactElement,
} from "react";
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
  type DocumentProps,
} from "@react-pdf/renderer";
import { buildStorageKey } from "@/lib/storage/keys";
import type { StorageProvider } from "@/lib/storage/types";
import type * as schema from "./schema";

const PDF_MIME_TYPE = "application/pdf";
const PAGE_PADDING_POINTS = 48;
const TITLE_FONT_SIZE_POINTS = 22;
const BODY_FONT_SIZE_POINTS = 12;
const LABEL_FONT_SIZE_POINTS = 9;
const CONTENT_GAP_POINTS = 16;

type SeedDocumentInsert = typeof schema.documents.$inferInsert;

const styles = StyleSheet.create({
  page: {
    padding: PAGE_PADDING_POINTS,
    fontFamily: "Helvetica",
    backgroundColor: "#ffffff",
    color: "#0f021a",
  },
  frame: {
    borderWidth: 1,
    borderColor: "#0f021a",
    padding: PAGE_PADDING_POINTS,
  },
  label: {
    fontFamily: "Courier",
    fontSize: LABEL_FONT_SIZE_POINTS,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  title: {
    fontSize: TITLE_FONT_SIZE_POINTS,
    marginTop: CONTENT_GAP_POINTS,
  },
  body: {
    fontSize: BODY_FONT_SIZE_POINTS,
    lineHeight: 1.5,
    marginTop: CONTENT_GAP_POINTS,
  },
});

const ViewComponent = View as ComponentType<Record<string, unknown>>;
const TextComponent = Text as ComponentType<Record<string, unknown>>;

function seedDocumentCode(row: SeedDocumentInsert): string {
  const metadata = row.metadata as Record<string, unknown> | undefined;
  for (const key of ["evidenceReference", "boundaryReference"] as const) {
    const value = metadata?.[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return row.fileName.replace(/\.pdf$/i, "");
}

/** Render a small, valid, clearly synthetic PDF fixture with react-pdf. */
export async function renderSyntheticSeedPdf(
  documentCode: string,
): Promise<Buffer> {
  const document = h(
    Document,
    {
      title: `Synthetic seed fixture — ${documentCode}`,
      author: "noma dMRV",
      subject: "Synthetic seed evidence fixture",
    },
    h(
      Page,
      { size: "A4", style: styles.page },
      h(
        ViewComponent,
        { style: styles.frame },
        h(TextComponent, { style: styles.label }, "noma dMRV"),
        h(TextComponent, { style: styles.title }, documentCode),
        h(
          TextComponent,
          { style: styles.body },
          "Synthetic seed fixture. This generated one-page PDF contains no real operational evidence and exists only for local demonstration and testing.",
        ),
      ),
    ),
  );
  return renderToBuffer(
    document as ReactElement<DocumentProps>,
  );
}

/**
 * Materialise seed document rows through the production server-side storage
 * seam, returning rows whose storage triple, byte size, and checksum match the
 * generated object exactly.
 */
export async function storeSyntheticSeedDocuments(
  provider: StorageProvider,
  rows: SeedDocumentInsert[],
): Promise<SeedDocumentInsert[]> {
  return Promise.all(
    rows.map(async (row) => {
      const pdf = await renderSyntheticSeedPdf(seedDocumentCode(row));
      const storageKey = buildStorageKey({
        entityType: row.entityType,
        entityId: row.entityId,
        documentType: row.documentType,
        fileName: row.fileName,
      });
      await provider.putObject(storageKey, pdf, PDF_MIME_TYPE);
      return {
        ...row,
        storageProvider: provider.name,
        storageBucket: provider.bucket,
        storageKey,
        fileUrl: null,
        fileSizeBytes: pdf.byteLength,
        mimeType: PDF_MIME_TYPE,
        checksumSha256: createHash("sha256").update(pdf).digest("hex"),
        uploadStatus: "uploaded",
      };
    }),
  );
}
