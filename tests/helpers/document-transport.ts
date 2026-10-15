import { NextRequest } from "next/server";
import { expect } from "vitest";
import { POST as MCP } from "@/app/api/mcp/route";
import { PUT as putLocal, GET as getLocal } from "@/app/api/storage-local/[...key]/route";
import { documentReadHandler } from "@/lib/api/document-read-handlers";
import type { ApiDocumentOwnerType } from "@/lib/documents/api-owners";
import { API_DOCUMENT_OWNERS } from "@/lib/documents/api-owners";
import { rpc, rpcBody } from "./mcp";
import { DOCUMENT_BYTES, type ApiDocumentWriteFixture } from "./api-document-write-fixture";
import { readRequest } from "./api-order-read-fixture";

export async function documentTool(f: ApiDocumentWriteFixture, name: string, args: Record<string, unknown>, credential = f.writeKey) {
  const response = await MCP(rpc(credential, "tools/call", { name, arguments: args }));
  expect(response.status).toBe(200);
  const payload = await rpcBody(response);
  expect(payload.error).toBeUndefined();
  return payload.result;
}
function localParams(url: string) {
  return { params: Promise.resolve({ key: new URL(url).pathname.replace("/api/storage-local/", "").split("/").map(decodeURIComponent) }) };
}
export async function putDocument(upload: { url: string; headers: Record<string, string> }, bytes = DOCUMENT_BYTES) {
  const response = await putLocal(new NextRequest(upload.url, { method: "PUT", headers: upload.headers, body: new Uint8Array(bytes) }), localParams(upload.url));
  expect(response.status).toBe(204);
}
export async function downloadDocument(url: string) {
  const response = await getLocal(new NextRequest(url), localParams(url));
  expect(response.status).toBe(200);
  return Buffer.from(await response.arrayBuffer());
}
export function restDocumentRead(f: ApiDocumentWriteFixture, owner: ApiDocumentOwnerType, kind: "list" | "get" | "content", documentId?: string, query = "") {
  const idOrCode = f.owners[owner].id;
  const path = `/${API_DOCUMENT_OWNERS[owner].path}/${idOrCode}/documents${documentId ? `/${documentId}` : ""}${kind === "content" ? "/content" : ""}${query}`;
  return documentReadHandler(owner, kind)(readRequest(path, f.writeKey), { params: Promise.resolve({ idOrCode, documentId }) });
}
