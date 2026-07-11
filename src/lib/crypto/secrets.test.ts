import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret } from "./secrets";

const TEST_KEY = "11".repeat(32);
let originalKey: string | undefined;

beforeEach(() => {
  originalKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  process.env.CREDENTIALS_ENCRYPTION_KEY = TEST_KEY;
});

afterEach(() => {
  if (originalKey === undefined) {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
  } else {
    process.env.CREDENTIALS_ENCRYPTION_KEY = originalKey;
  }
});

describe("secret encryption", () => {
  it("round-trips plaintext with hexadecimal and base64 keys", () => {
    const plaintext = "registry credential value";
    const encryptedWithHex = encryptSecret(plaintext);
    expect(decryptSecret(encryptedWithHex)).toBe(plaintext);

    process.env.CREDENTIALS_ENCRYPTION_KEY = Buffer.from(
      TEST_KEY,
      "hex"
    ).toString("base64");
    const encryptedWithBase64 = encryptSecret(plaintext);
    expect(decryptSecret(encryptedWithBase64)).toBe(plaintext);
  });

  it("uses a unique IV for each encryption", () => {
    expect(encryptSecret("same plaintext")).not.toBe(
      encryptSecret("same plaintext")
    );
  });

  it("detects ciphertext tampering", () => {
    const parts = encryptSecret("tamper-resistant").split(":");
    const ciphertext = Buffer.from(parts[2], "base64");
    ciphertext[0] ^= 1;
    parts[2] = ciphertext.toString("base64");

    expect(() => decryptSecret(parts.join(":"))).toThrow(
      "Encrypted secret authentication failed."
    );
  });

  it("loads safely and fails clearly on use when the key is missing", async () => {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    vi.resetModules();

    await expect(import("./secrets")).resolves.toMatchObject({
      encryptSecret: expect.any(Function),
      decryptSecret: expect.any(Function),
    });

    expect(() => encryptSecret("value")).toThrow(
      "CREDENTIALS_ENCRYPTION_KEY is required"
    );
    expect(() => decryptSecret("v1:a:b:c")).toThrow(
      "CREDENTIALS_ENCRYPTION_KEY is required"
    );
  });

  it("rejects malformed keys", () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = "not-a-32-byte-key";

    expect(() => encryptSecret("value")).toThrow(
      "CREDENTIALS_ENCRYPTION_KEY must be a 32-byte key"
    );
  });
});
