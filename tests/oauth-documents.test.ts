/** OAuth MCP, real upload routes and local storage. Not run, needs the supervisor. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "@/db";
import { activityEvents, documents, members } from "@/db/schema";
import { POST as MCP } from "@/app/api/mcp/route";
import { getOAuthConfig } from "@/lib/auth/oauth-config";
import { __setStorageProviderForTests } from "@/lib/storage";
import { LocalFsProvider } from "@/lib/storage/local-fs";
import { documentRepresentationSchema } from "@/lib/representations/documents";
import { documentUploadEnvelopeSchema } from "@/lib/representations/document-writes";
import { createApiDocumentWriteFixture, removeApiDocumentWriteFixture, documentInput, DOCUMENT_BYTES, type ApiDocumentWriteFixture } from "./helpers/api-document-write-fixture";
import { putDocument } from "./helpers/document-transport";
import { createOAuthFixture, oauthRpc, type OAuthFixture } from "./helpers/oauth";
import { rpcBody } from "./helpers/mcp";

const TIMEOUT_MS = 30_000;
const mocks = vi.hoisted(() => ({ root: "", secret: "oauth-documents-test-signing-secret" }));
vi.mock("@/config/env", async importOriginal => {
  const original = await importOriginal<typeof import("@/config/env")>();
  return { ...original, env: { ...original.env, OAUTH_PROVIDER_ENABLED: true, API_WRITES_DISABLED: false,
    STORAGE_PROVIDER: "local-fs", STORAGE_SIGNING_SECRET: mocks.secret, get STORAGE_LOCAL_FS_ROOT() { return mocks.root; } } };
});
let f: ApiDocumentWriteFixture;
let oauth: OAuthFixture;
let memberId: string;
beforeEach(async () => {
  vi.stubEnv("DISABLE_RATE_LIMIT", "true");
  f = await createApiDocumentWriteFixture();
  oauth = await createOAuthFixture();
  memberId = randomUUID();
  await db.insert(members).values({ id: memberId, organizationId: f.ctx.organizationId, userId: oauth.userId, role: "member" });
  mocks.root = await mkdtemp(join(tmpdir(), "oauth-documents-"));
  __setStorageProviderForTests(new LocalFsProvider({ root: mocks.root, appUrl: "http://localhost:3100", signingSecret: mocks.secret }));
}, TIMEOUT_MS);
afterEach(async () => {
  __setStorageProviderForTests(null);
  vi.unstubAllEnvs();
  if (oauth) await oauth.cleanup();
  if (f) await removeApiDocumentWriteFixture(f);
  if (mocks.root) await rm(mocks.root, { recursive: true, force: true });
}, TIMEOUT_MS);
const access = (resource = getOAuthConfig().mcp) => oauth.accessToken({ resource, organizationId: f.ctx.organizationId,
  memberId, scopes: ["deliveries:read", "deliveries:write"] });
const owner = () => ({ ownerType: "delivery", ownerId: f.owners.delivery.id });

it("requests, PUTs without a credential and confirms with the OAuth MCP generation", async () => {
  const token = await access();
  const requested = await MCP(oauthRpc(token, "tools/call", { name: "request_document_upload", arguments: {
    ...owner(), ...documentInput(), requestKey: randomUUID(),
  } }));
  expect(requested.status).toBe(200);
  const result = (await rpcBody(requested)).result;
  expect(result.isError).toBeUndefined();
  const pending = documentUploadEnvelopeSchema.parse(result.structuredContent);
  const document = documentRepresentationSchema.parse(pending.data);
  expect(pending.upload).not.toBeNull();
  await putDocument(pending.upload!, DOCUMENT_BYTES);

  const rest = await access(getOAuthConfig().rest);
  const wrongAudience = await MCP(oauthRpc(rest, "tools/call", { name: "confirm_document_upload", arguments: { ...owner(), documentId: document.id } }));
  expect(wrongAudience.status).toBe(401);
  expect(wrongAudience.headers.get("www-authenticate")).toContain('error="invalid_token"');
  expect(await wrongAudience.json()).toMatchObject({ code: "credential_audience_mismatch" });
  expect((await db.select().from(documents).where(eq(documents.id, document.id)))[0].uploadStatus).toBe("pending");

  const confirm = () => MCP(oauthRpc(token, "tools/call", { name: "confirm_document_upload", arguments: { ...owner(), documentId: document.id } }));
  const confirmed = await confirm();
  expect(confirmed.status).toBe(200);
  const uploaded = (await rpcBody(confirmed)).result;
  expect(uploaded.isError).toBeUndefined();
  expect(uploaded.structuredContent).toMatchObject({ data: { id: document.id, uploadStatus: "uploaded", version: 2 } });
  expect((await rpcBody(await confirm())).result.structuredContent).toEqual(uploaded.structuredContent);
  const events = await db.select().from(activityEvents).where(eq(activityEvents.entityId, document.id));
  expect(events).toHaveLength(2);
  expect(events.every(event => event.credentialId === token.grant.id && event.oauthClientId === oauth.clientId && event.source === "mcp")).toBe(true);
}, TIMEOUT_MS);
