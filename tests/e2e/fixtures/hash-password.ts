/**
 * Better Auth Password Hashing
 *
 * Shared scrypt password hashing that matches Better Auth's internal format.
 * Used by both the database seed script and E2E test fixtures.
 */
import * as crypto from "crypto";
import { scryptAsync } from "@noble/hashes/scrypt.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const scryptConfig = {
  N: 16384,
  r: 16,
  p: 1,
  dkLen: 64,
};

/**
 * Hash password using Better Auth's scrypt implementation.
 * Output format: {salt}:{key}
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const key = await scryptAsync(password.normalize("NFKC"), salt, {
    N: scryptConfig.N,
    p: scryptConfig.p,
    r: scryptConfig.r,
    dkLen: scryptConfig.dkLen,
    maxmem: 128 * scryptConfig.N * scryptConfig.r * 2,
  });
  return `${salt}:${bytesToHex(key)}`;
}
