// Password hashing with Node's built-in scrypt (no dependency). Stored as
// `scrypt$<saltHex>$<hashHex>`. Node-only - imported exclusively from route
// handlers (never middleware or client).

import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  let derived: Buffer;
  try {
    derived = (await scryptAsync(password, salt, expected.length)) as Buffer;
  } catch {
    return false;
  }
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

/** Minimum password policy. `requireNumber` defaults to true; the first-time
 *  setup passes false so the initial admin password isn't forced to include a digit. */
export function passwordProblem(password: string, opts: { requireNumber?: boolean } = {}): string | null {
  const requireNumber = opts.requireNumber ?? true;
  if (typeof password !== "string" || password.length < 10) return "Password must be at least 10 characters.";
  if (!/[a-zA-Z]/.test(password)) return "Password must contain a letter.";
  if (requireNumber && !/[0-9]/.test(password)) return "Password must contain a number.";
  return null;
}
