import { expect, it } from "vitest";
import { replaceEmissionLineFilesSchema } from "./emission-line-files";

it("lowercases ids so an uppercase anchor id still matches the stored row", () => {
  const id = "3F2504E0-4F89-41D3-9A0C-0305E82C3301";
  expect(replaceEmissionLineFilesSchema.parse({ creditBatchId: id, componentId: "c", anchorId: id, expectedVersion: 1 }))
    .toMatchObject({ creditBatchId: id.toLowerCase(), anchorId: id.toLowerCase() });
});
