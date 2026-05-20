/**
 * /api/documents/[id] Proxy Route Tests
 *
 * Covers each branch of the 5-step resolution order:
 * 1. Not-found 404
 * 2. Visibility/auth gate (private + anon = 401)
 * 3. storageKey branch (signed GET redirect; pending → 404)
 * 4. fileUrl branch (direct redirect; gate still applies)
 * 5. Invariant violation → 500
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/server", () => ({
  getUser: vi.fn(),
}));

vi.mock("@/data-access/documents", () => ({
  getDocumentById: vi.fn(),
  getPublicDocumentById: vi.fn(),
}));

import { getUser } from "@/lib/auth/server";
import { getDocumentById, getPublicDocumentById } from "@/data-access/documents";
import { GET } from "@/app/api/documents/[id]/route";
import { __setStorageProviderForTests } from "@/lib/storage";
import type { ObjectHead, PresignedUpload, StorageProvider } from "@/lib/storage";

const SIGNED_URL = "https://signed.test/object?sig=abc";

class StubProvider implements StorageProvider {
  readonly name = "local-fs" as const;
  readonly bucket = "local-fs";
  async createUploadUrl(): Promise<PresignedUpload> {
    throw new Error("not used in tests");
  }
  async createDownloadUrl(): Promise<string> {
    return SIGNED_URL;
  }
  async headObject(): Promise<ObjectHead | null> {
    return null;
  }
  async deleteObject(): Promise<void> {}
}

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  name: "Test",
  emailVerified: true,
  role: "admin" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const docId = "11111111-2222-4333-8444-555555555555";

const baseRow = {
  id: docId,
  entityType: "sample",
  entityId: "00000000-0000-0000-0000-000000000001",
  documentType: "lab_report",
  storageProvider: "stub",
  storageBucket: "noma-test",
  storageKey: "sample/abc/lab_report/01.pdf",
  fileUrl: null as string | null,
  fileName: "report.pdf",
  fileSizeBytes: 1024,
  mimeType: "application/pdf",
  checksumSha256: null,
  visibility: "private" as const,
  uploadStatus: "uploaded" as const,
  issuedAt: null,
  capturedAt: null,
  description: null,
  metadata: {},
  createdBy: null,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeRequest(): NextRequest {
  return new NextRequest(`http://localhost/api/documents/${docId}`);
}

function makeCtx() {
  return { params: Promise.resolve({ id: docId }) };
}

beforeEach(() => {
  __setStorageProviderForTests(new StubProvider());
  vi.mocked(getUser).mockReset();
  vi.mocked(getDocumentById).mockReset();
  vi.mocked(getPublicDocumentById).mockReset();
});

describe("GET /api/documents/[id]", () => {
  it("returns 404 when authed user requests missing document", async () => {
    vi.mocked(getUser).mockResolvedValueOnce(mockUser);
    vi.mocked(getDocumentById).mockResolvedValueOnce(null);
    const res = await GET(makeRequest(), makeCtx());
    expect(res.status).toBe(404);
  });

  it("returns 400 on malformed id", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/documents/not-a-uuid"),
      { params: Promise.resolve({ id: "not-a-uuid" }) }
    );
    expect(res.status).toBe(400);
  });

  it("private + anon → 401", async () => {
    vi.mocked(getUser).mockResolvedValueOnce(null);
    vi.mocked(getPublicDocumentById).mockResolvedValueOnce(null);
    const res = await GET(makeRequest(), makeCtx());
    expect(res.status).toBe(401);
  });

  it("private + authed → 302 to signed URL", async () => {
    vi.mocked(getUser).mockResolvedValueOnce(mockUser);
    vi.mocked(getDocumentById).mockResolvedValueOnce({
      ...baseRow,
      visibility: "private",
    } as never);
    const res = await GET(makeRequest(), makeCtx());
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(SIGNED_URL);
  });

  it("public + anon → 302 to signed URL (no auth required)", async () => {
    vi.mocked(getUser).mockResolvedValueOnce(null);
    vi.mocked(getPublicDocumentById).mockResolvedValueOnce({
      ...baseRow,
      visibility: "public",
    } as never);
    const res = await GET(makeRequest(), makeCtx());
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(SIGNED_URL);
  });

  it("uploadStatus=pending → 404 (refuses un-confirmed uploads)", async () => {
    vi.mocked(getUser).mockResolvedValueOnce(mockUser);
    vi.mocked(getDocumentById).mockResolvedValueOnce({
      ...baseRow,
      uploadStatus: "pending",
      visibility: "public",
    } as never);
    const res = await GET(makeRequest(), makeCtx());
    expect(res.status).toBe(404);
  });

  it("public legacy fileUrl row + authed → 302 to external URL", async () => {
    vi.mocked(getUser).mockResolvedValueOnce(mockUser);
    vi.mocked(getDocumentById).mockResolvedValueOnce({
      ...baseRow,
      storageKey: null,
      fileUrl: "https://example.com/external.pdf",
      visibility: "public",
    } as never);
    const res = await GET(makeRequest(), makeCtx());
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/external.pdf");
  });

  it("private legacy fileUrl + anon → 401 (gate applies to external URLs)", async () => {
    vi.mocked(getUser).mockResolvedValueOnce(null);
    vi.mocked(getPublicDocumentById).mockResolvedValueOnce(null);
    const res = await GET(makeRequest(), makeCtx());
    expect(res.status).toBe(401);
  });

  it("invariant violation (neither storageKey nor fileUrl) → 500", async () => {
    vi.mocked(getUser).mockResolvedValueOnce(mockUser);
    vi.mocked(getDocumentById).mockResolvedValueOnce({
      ...baseRow,
      storageKey: null,
      fileUrl: null,
      visibility: "public",
    } as never);
    const res = await GET(makeRequest(), makeCtx());
    expect(res.status).toBe(500);
  });
});
