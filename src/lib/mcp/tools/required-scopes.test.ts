import { expect, it, vi } from "vitest";
vi.mock("@/db", () => ({ db: {} }));
import { readTools } from "./read-tools";
import { writeTools } from "./write-tools";

const tools = [...readTools, ...writeTools];
it.each(tools)("declares pure required scopes for registered tool $name", tool => {
  expect(tool.requiredScopes).toBeTypeOf("function");
  if (tool.name === "whoami") expect(tool.requiredScopes({})).toEqual([]);
  else if (tool.scope) {
    expect(tool.requiredScopes({})).toEqual([tool.scope]);
    expect(tool.requiredScopes({ ownerType: "delivery" })).toEqual([tool.scope]);
  }
});
it.each([
  { ownerType: "feedstock", read: "feedstocks:read", write: "feedstocks:write" },
  { ownerType: "delivery", read: "deliveries:read", write: "deliveries:write" },
  { ownerType: "lab_sample", read: "lab-samples:read", write: "lab-samples:write" },
  { ownerType: "application", read: "applications:read", write: "applications:write" },
])("resolves document scopes from $ownerType without looking up the owner", ({ ownerType, read, write }) => {
  for (const name of ["find_documents", "get_document_download_url", "request_document_upload", "confirm_document_upload"]) {
    const tool = tools.find(tool => tool.name === name)!;
    expect(tool.requiredScopes({ ownerType })).toEqual([tool.kind === "read" ? read : write]);
  }
});
it.each([undefined, null, {}, { ownerType: "__proto__" }, { ownerType: "unknown" }])("rejects an invalid document owner without inferring a scope", args => {
  expect(() => tools.find(tool => tool.name === "request_document_upload")!.requiredScopes(args)).toThrow();
});
