import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const PAYLOAD_VERSION = "v1";
const PAYLOAD_PART_COUNT = 4;
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const HEX_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;
const BASE64_KEY_PATTERN = /^[A-Za-z0-9+/]{43}=?$/;

function decodeEncryptionKey(): Buffer {
  const configuredKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!configuredKey) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY is required to encrypt or decrypt certifier credentials."
    );
  }

  let key: Buffer;
  if (HEX_KEY_PATTERN.test(configuredKey)) {
    key = Buffer.from(configuredKey, "hex");
  } else if (BASE64_KEY_PATTERN.test(configuredKey)) {
    key = Buffer.from(configuredKey, "base64");
    const normalizedInput = configuredKey.replace(/=+$/, "");
    const normalizedDecoded = key.toString("base64").replace(/=+$/, "");
    if (normalizedInput !== normalizedDecoded) {
      throw malformedKeyError();
    }
  } else {
    throw malformedKeyError();
  }

  if (key.length !== KEY_LENGTH_BYTES) {
    throw malformedKeyError();
  }
  return key;
}

function malformedKeyError(): Error {
  return new Error(
    "CREDENTIALS_ENCRYPTION_KEY must be a 32-byte key encoded as 64 hexadecimal characters or base64."
  );
}

function decodePayloadPart(value: string, label: string): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new Error(`Encrypted secret has invalid ${label} encoding.`);
  }
  return decoded;
}

export function encryptSecret(plaintext: string): string {
  const key = decodeEncryptionKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    PAYLOAD_VERSION,
    iv.toString("base64"),
    ciphertext.toString("base64"),
    authTag.toString("base64"),
  ].join(":");
}

export function decryptSecret(payload: string): string {
  const key = decodeEncryptionKey();
  const parts = payload.split(":");
  if (parts.length !== PAYLOAD_PART_COUNT) {
    throw new Error("Encrypted secret has an invalid payload format.");
  }

  const [version, encodedIv, encodedCiphertext, encodedAuthTag] = parts;
  if (version !== PAYLOAD_VERSION) {
    throw new Error(`Encrypted secret uses unsupported version "${version}".`);
  }

  const iv = decodePayloadPart(encodedIv, "IV");
  const ciphertext = decodePayloadPart(encodedCiphertext, "ciphertext");
  const authTag = decodePayloadPart(encodedAuthTag, "authentication tag");
  if (iv.length !== IV_LENGTH_BYTES || authTag.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new Error("Encrypted secret has invalid cryptographic parameters.");
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Encrypted secret authentication failed.");
  }
}
