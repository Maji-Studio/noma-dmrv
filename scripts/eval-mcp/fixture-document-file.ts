import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const PDF_XREF_OFFSET_WIDTH = 10;
const PDF_PAGE_WIDTH = 300;
const PDF_PAGE_HEIGHT = 144;

/** A one-page PDF with a catalog, page tree, text stream, font and byte-accurate xref. */
export function billOfLadingPdf(): Buffer {
  const stream = "BT /F1 12 Tf 20 100 Td (Evaluation bill of lading) Tj ET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(pdf);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(PDF_XREF_OFFSET_WIDTH, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf);
}

export async function writeBillOfLading(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const bytes = billOfLadingPdf();
  const filePath = join(directory, "bol.pdf");
  await writeFile(filePath, bytes, { mode: 0o600 });
  return { filePath, sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length };
}
