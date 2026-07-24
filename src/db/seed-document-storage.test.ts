import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { StorageProvider } from "@/lib/storage/types";
import { storeSyntheticSeedDocuments } from "./seed-document-storage";

describe("storeSyntheticSeedDocuments", () => {
  it("stores a generated PDF and records storage metadata matching its bytes", async () => {
    const putObject = vi.fn<StorageProvider["putObject"]>().mockResolvedValue();
    const provider: StorageProvider = {
      name: "local-fs",
      bucket: "local-fs",
      putObject,
      createUploadUrl: vi.fn(),
      createDownloadUrl: vi.fn(),
      headObject: vi.fn(),
      deleteObject: vi.fn(),
    };

    const [stored] = await storeSyntheticSeedDocuments(provider, [
      {
        id: "de000000-0000-4000-a000-000000003200",
        organizationId: "dec",
        entityType: "feedstock",
        entityId: "de000000-0000-4000-a000-000000001750",
        documentType: "weighbridge_ticket",
        fileName: "FS-26-001-weighbridge-ticket.pdf",
        fileUrl: "https://example.com/legacy-fixture.pdf",
        metadata: { evidenceReference: "WST-FD-26-001" },
      },
    ]);

    expect(putObject).toHaveBeenCalledOnce();
    const [storageKey, bytes, contentType] = putObject.mock.calls[0];
    expect(storageKey).toMatch(
      /^feedstock\/de000000-0000-4000-a000-000000001750\/weighbridge_ticket\/[a-z0-9]+\.pdf$/,
    );
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(contentType).toBe("application/pdf");
    expect(stored).toMatchObject({
      storageProvider: "local-fs",
      storageBucket: "local-fs",
      storageKey,
      fileUrl: null,
      fileSizeBytes: bytes.byteLength,
      mimeType: "application/pdf",
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
      uploadStatus: "uploaded",
    });
  });

  it("waits for sibling uploads and collects only successful storage keys", async () => {
    const failedEntityId = "de000000-0000-4000-a000-000000001751";
    const uploadError = new Error("upload failed");
    let resolveSuccessfulUpload!: () => void;
    const successfulUpload = new Promise<void>((resolve) => {
      resolveSuccessfulUpload = resolve;
    });
    const settledKeys: string[] = [];
    const putObject = vi
      .fn<StorageProvider["putObject"]>()
      .mockImplementation(async (key) => {
        if (key.includes(failedEntityId)) throw uploadError;
        await successfulUpload;
        settledKeys.push(key);
      });
    const provider: StorageProvider = {
      name: "local-fs",
      bucket: "local-fs",
      putObject,
      createUploadUrl: vi.fn(),
      createDownloadUrl: vi.fn(),
      headObject: vi.fn(),
      deleteObject: vi.fn(),
    };
    const uploadedKeys: string[] = [];
    let functionSettled = false;

    const result = storeSyntheticSeedDocuments(
      provider,
      [
        {
          id: "de000000-0000-4000-a000-000000003201",
          organizationId: "dec",
          entityType: "feedstock",
          entityId: "de000000-0000-4000-a000-000000001750",
          documentType: "weighbridge_ticket",
          fileName: "FS-26-001-weighbridge-ticket.pdf",
          metadata: { evidenceReference: "WST-FD-26-001" },
        },
        {
          id: "de000000-0000-4000-a000-000000003202",
          organizationId: "dec",
          entityType: "feedstock",
          entityId: failedEntityId,
          documentType: "weighbridge_ticket",
          fileName: "FS-26-002-weighbridge-ticket.pdf",
          metadata: { evidenceReference: "WST-FD-26-002" },
        },
      ],
      uploadedKeys,
    ).then(
      (value) => {
        functionSettled = true;
        return value;
      },
      (error: unknown) => {
        functionSettled = true;
        throw error;
      },
    );

    await vi.waitFor(() => {
      expect(putObject).toHaveBeenCalledTimes(2);
    });
    expect(functionSettled).toBe(false);

    resolveSuccessfulUpload();
    await expect(result).rejects.toBe(uploadError);

    const successfulKey = putObject.mock.calls
      .map(([key]) => key)
      .find((key) => !key.includes(failedEntityId));
    expect(successfulKey).toBeDefined();
    expect(settledKeys).toEqual([successfulKey]);
    expect(uploadedKeys).toEqual([successfulKey]);
  });
});
