import type { FilePolicy } from "@/lib/isometric/template-observations/file-policies";

export const ENTRY_FILE_CASES: { label: string; magnitudes: string[]; filePolicy?: FilePolicy; missing: boolean }[] = [
  { label: "zero", magnitudes: ["0"], missing: false },
  { label: "decimal zero", magnitudes: ["0.000"], missing: false },
  { label: "negative zero", magnitudes: ["-0"], missing: false },
  { label: "non-zero", magnitudes: ["0.5"], missing: true },
  { label: "tiny non-zero", magnitudes: ["0.00000000000000000001"], missing: true },
  { label: "paired mixed values", magnitudes: ["0", "5"], missing: true },
  { label: "paired zeros", magnitudes: ["0", "0.000"], missing: false },
  { label: "paired cancelling values", magnitudes: ["-5", "5"], missing: true },
  { label: "no files required", magnitudes: ["0.5"], filePolicy: "none", missing: false },
  { label: "entry files", magnitudes: ["0.5"], filePolicy: "entryFiles", missing: true },
  { label: "generated evidence", magnitudes: ["0.5"], filePolicy: "generated", missing: true },
  { label: "component file covers only records", magnitudes: ["0.5"], filePolicy: "lineFile", missing: true },
];
