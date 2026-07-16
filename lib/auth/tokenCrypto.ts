// Symmetric encryption for AutoX refresh tokens stored at rest in the DB.
// AES-256-GCM with a key derived from AUTH_SECRET. A refresh token is a bearer
// credential that can mint access tokens, so it must never sit in the DB in clear.
// Node-only (node:crypto) — imported from nodejs-runtime route handlers / server
// modules, never edge middleware.

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

function key(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return createHash("sha256").update(secret).digest(); // 32 bytes for aes-256
}

/** Encrypt to `iv.tag.ciphertext` (all base64). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

/** Inverse of encryptSecret. Throws on a malformed/forged blob or a rotated key. */
export function decryptSecret(enc: string): string {
  const [ivB, tagB, ctB] = enc.split(".");
  if (!ivB || !tagB || !ctB) throw new Error("malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64")), decipher.final()]).toString("utf8");
}
