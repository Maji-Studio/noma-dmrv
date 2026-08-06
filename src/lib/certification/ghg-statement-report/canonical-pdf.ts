/**
 * Canonicalize @react-pdf/renderer output so one report model always renders to
 * one exact byte string (and therefore one `contentChecksumSha256`).
 *
 * Pinning the document metadata is necessary but not sufficient. Two further
 * sources of run-to-run drift live inside @react-pdf/pdfkit 5.1.1 and have no
 * configuration seam in @react-pdf/renderer 4.5.1:
 *
 * 1. Every stream object is compressed through an async `zlib.createDeflate()`
 *    and written when its own deflate ends, so the libuv threadpool decides the
 *    order objects land in the file. The objects are identical run to run; only
 *    their file positions (and hence the xref offsets) permute.
 * 2. Each embedded subset font gets a 6-letter tag built from `Math.random()`
 *    (`/FontName /QJGIII+DMSans-Bold`).
 *
 * So we normalize the finished bytes instead: objects are re-emitted in
 * object-id order behind a rebuilt xref table, and each subset tag is replaced
 * by one derived from the font's PostScript name. Every rewrite is
 * length-preserving, so the header, the xref table and the trailer keep their
 * sizes and the original `startxref` stays correct.
 *
 * The parser is deliberately strict: if pdfkit ever emits a shape this does not
 * recognise, it throws rather than returning bytes that are silently unstable
 * (or, worse, reordered wrongly). The colocated tests are the tripwire.
 */
import { createHash } from "node:crypto";

const XREF_KEYWORD = "xref";
const STARTXREF_KEYWORD = "startxref";
const STREAM_MARKER = "\nstream\n";
/** `0000000000 00000 n ` plus the newline pdfkit appends to every write. */
const XREF_ENTRY_BYTES = 20;
const XREF_OFFSET_DIGITS = 10;
const XREF_FREE_ENTRY = "0000000000 65535 f ";
const SUBSET_TAG_LENGTH = 6;
const UPPERCASE_LETTER_COUNT = 26;
const UPPERCASE_A_CODE_POINT = 65;

const XREF_ENTRY_PATTERN = /^(\d{10}) \d{5} n \n$/;
const XREF_SECTION_HEADER_PATTERN = /^0 (\d+)$/;
/** `/FontName /QJGIII+DMSans-Bold` and its `/BaseFont` twin. */
const SUBSET_TAG_PATTERN = /\/(FontName|BaseFont) \/[A-Z]{6}\+([^\s/<>[\]()]+)/g;

export class NonCanonicalPdfError extends Error {
  constructor(message: string) {
    super(`Cannot canonicalize the rendered PDF: ${message}`);
    this.name = "NonCanonicalPdfError";
  }
}

/** Stable stand-in for pdfkit's random subset tag: 6 letters keyed by font name. */
export function subsetTag(postscriptName: string): string {
  const digest = createHash("sha256").update(postscriptName).digest();
  let tag = "";
  for (let index = 0; index < SUBSET_TAG_LENGTH; index += 1) {
    tag += String.fromCharCode(
      UPPERCASE_A_CODE_POINT + (digest[index] % UPPERCASE_LETTER_COUNT),
    );
  }
  return tag;
}

/** Rewrite subset tags in an object's dictionary, never inside its stream data. */
function normalizeSubsetTags(block: Buffer): Buffer {
  const streamAt = block.indexOf(STREAM_MARKER);
  const dictionaryEnd = streamAt === -1 ? block.length : streamAt;
  const dictionary = block.toString("latin1", 0, dictionaryEnd);
  const normalized = dictionary.replace(
    SUBSET_TAG_PATTERN,
    (_match, key: string, name: string) => `/${key} /${subsetTag(name)}+${name}`,
  );
  if (normalized === dictionary) return block;
  if (normalized.length !== dictionary.length) {
    throw new NonCanonicalPdfError("subset tag rewrite changed the byte length");
  }
  return Buffer.concat([
    Buffer.from(normalized, "latin1"),
    block.subarray(dictionaryEnd),
  ]);
}

function readStartXref(text: string): number {
  const marker = text.lastIndexOf(STARTXREF_KEYWORD);
  if (marker === -1) throw new NonCanonicalPdfError("no startxref");
  const value = Number.parseInt(
    text.slice(marker + STARTXREF_KEYWORD.length).trim(),
    10,
  );
  if (!Number.isInteger(value) || value <= 0 || value >= text.length) {
    throw new NonCanonicalPdfError("startxref does not point into the file");
  }
  return value;
}

/** Object offsets keyed by position: index `i` holds the offset of object `i + 1`. */
function readXrefOffsets(
  text: string,
  xrefStart: number,
): { offsets: number[]; tableEnd: number } {
  if (!text.startsWith(`${XREF_KEYWORD}\n`, xrefStart)) {
    throw new NonCanonicalPdfError("startxref does not point at an xref table");
  }
  const headerStart = xrefStart + XREF_KEYWORD.length + 1;
  const headerEnd = text.indexOf("\n", headerStart);
  const header = XREF_SECTION_HEADER_PATTERN.exec(
    text.slice(headerStart, headerEnd),
  );
  if (!header) {
    throw new NonCanonicalPdfError("unsupported xref section header");
  }
  const entryCount = Number(header[1]);
  const tableStart = headerEnd + 1;
  const offsets: number[] = [];
  // Entry 0 is the mandatory free head; objects start at 1.
  for (let index = 1; index < entryCount; index += 1) {
    const entryStart = tableStart + index * XREF_ENTRY_BYTES;
    const entry = XREF_ENTRY_PATTERN.exec(
      text.slice(entryStart, entryStart + XREF_ENTRY_BYTES),
    );
    if (!entry) {
      throw new NonCanonicalPdfError(`unreadable xref entry for object ${index}`);
    }
    offsets.push(Number(entry[1]));
  }
  return { offsets, tableEnd: tableStart + entryCount * XREF_ENTRY_BYTES };
}

function buildXrefTable(offsets: number[]): Buffer {
  const rows = [
    XREF_KEYWORD,
    `0 ${offsets.length + 1}`,
    XREF_FREE_ENTRY,
    ...offsets.map(
      (offset) => `${String(offset).padStart(XREF_OFFSET_DIGITS, "0")} 00000 n `,
    ),
  ];
  return Buffer.from(`${rows.join("\n")}\n`, "latin1");
}

/**
 * Re-emit a rendered PDF in object-id order with deterministic subset tags.
 * Byte length, object ids and object contents are all preserved.
 */
export function canonicalizePdfBytes(pdf: Buffer): Buffer {
  const text = pdf.toString("latin1");
  const xrefStart = readStartXref(text);
  const { offsets, tableEnd } = readXrefOffsets(text, xrefStart);
  if (offsets.length === 0) {
    throw new NonCanonicalPdfError("the xref table lists no objects");
  }

  const ascending = [...offsets].sort((left, right) => left - right);
  const bodyStart = ascending[0];
  const blockEnds = new Map<number, number>();
  ascending.forEach((offset, index) => {
    if (blockEnds.has(offset)) {
      throw new NonCanonicalPdfError("two objects share one offset");
    }
    blockEnds.set(
      offset,
      index + 1 < ascending.length ? ascending[index + 1] : xrefStart,
    );
  });
  if (bodyStart <= 0 || ascending[ascending.length - 1] >= xrefStart) {
    throw new NonCanonicalPdfError("object offsets fall outside the body");
  }

  const parts: Buffer[] = [pdf.subarray(0, bodyStart)];
  const canonicalOffsets: number[] = [];
  let cursor = bodyStart;
  for (const offset of offsets) {
    const block = normalizeSubsetTags(
      pdf.subarray(offset, blockEnds.get(offset)),
    );
    canonicalOffsets.push(cursor);
    parts.push(block);
    cursor += block.length;
  }
  if (cursor !== xrefStart) {
    throw new NonCanonicalPdfError("reordered objects do not fill the body");
  }

  parts.push(buildXrefTable(canonicalOffsets), pdf.subarray(tableEnd));
  const canonical = Buffer.concat(parts);
  if (canonical.length !== pdf.length) {
    throw new NonCanonicalPdfError("canonical output changed the file length");
  }
  return canonical;
}
