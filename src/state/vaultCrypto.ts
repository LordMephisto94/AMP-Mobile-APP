/**
 * The cryptography behind the token vault, kept free of app state so tests can build a
 * vault the same way the app does.
 *
 * A PIN never touches the disk. The key is derived from it with PBKDF2-SHA-256 (600,000
 * rounds, a random 16-byte salt per vault) and seals the saved sessions with AES-256-GCM
 * (a fresh 12-byte IV per write, so every write is authenticated and tamper-evident).
 * A wrong PIN is told apart from a damaged vault by a sealed check value.
 */

export const PBKDF2_ROUNDS = 600_000;
/** More than this in a vault file is a damaged or altered file: unlocking it would freeze the app. */
const MAX_ROUNDS = 5_000_000;
const CHECK = "amp-mobile-vault-v1";

export interface Sealed {
  iv: string;
  ct: string;
}

/** A vault sealed by the PIN alone (devices without a usable key store). */
export interface VaultBlobV1 {
  v: 1;
  salt: string;
  rounds: number;
  check: Sealed;
  data: Sealed;
}

/**
 * A vault bound to this device. A random data key seals the sessions. It's kept twice,
 * each time sealed by a key in the device's key store that never leaves it:
 * `pinWrap` also needs the PIN (the data key sealed under the PIN's key first), and
 * `quickWrap`, when there is one, opens only within a minute of the phone being unlocked.
 * A copy of this file is useless anywhere else.
 */
export interface VaultBlobV2 {
  v: 2;
  salt: string;
  rounds: number;
  /**
   * Older vaults: the PIN's sealed box, wrapped by a phone key that works without the user. Code
   * running as the app can read the box and try PINs off the phone, so these are upgraded.
   */
  pinWrap?: string;
  /** Newer vaults: the data key sealed under a key made from the PIN and the phone's HMAC of it. */
  pinBox?: Sealed;
  quickWrap?: string;
  /** The data key sealed by the biometric key: fingerprint unlock (then there's no quickWrap). */
  bioWrap?: string;
  data: Sealed;
}

export type VaultBlob = VaultBlobV1 | VaultBlobV2;

/** The data key of a v2 vault, from its 32 raw bytes. */
export async function importDataKey(raw: Uint8Array): Promise<VaultKey> {
  return subtle().importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** An AES-GCM key from WebCrypto; opaque here (NSH's types declare the class, not the type). */
export type VaultKey = object;

interface Subtle {
  importKey(format: "raw", data: Uint8Array, algorithm: "PBKDF2" | "AES-GCM", extractable: false, usages: string[]): Promise<VaultKey>;
  deriveKey(algorithm: object, base: VaultKey, derived: object, extractable: false, usages: string[]): Promise<VaultKey>;
  deriveBits(algorithm: object, base: VaultKey, length: number): Promise<ArrayBuffer>;
  encrypt(algorithm: object, key: VaultKey, data: Uint8Array): Promise<ArrayBuffer>;
  decrypt(algorithm: object, key: VaultKey, data: Uint8Array): Promise<ArrayBuffer>;
}

function subtle(): Subtle {
  const s = (globalThis as unknown as { crypto?: { subtle?: Subtle } }).crypto?.subtle;
  if (!s) throw new Error("This device can't encrypt saved sign-ins");
  return s;
}

export function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromB64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

export async function deriveKey(pin: string, salt: Uint8Array, rounds = PBKDF2_ROUNDS): Promise<VaultKey> {
  const base = await subtle().importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey({ name: "PBKDF2", salt, iterations: rounds, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** The PBKDF2 output for a PIN as raw bytes: what the phone's key store then runs its HMAC over. */
export async function deriveBits(pin: string, salt: Uint8Array, rounds = PBKDF2_ROUNDS): Promise<Uint8Array> {
  const base = await subtle().importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await subtle().deriveBits({ name: "PBKDF2", salt, iterations: rounds, hash: "SHA-256" }, base, 256));
}

export async function seal(key: VaultKey, value: unknown): Promise<Sealed> {
  const iv = randomBytes(12);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

/** Opens a sealed value; throws when the key is wrong or the data was altered. */
export async function unseal<T>(key: VaultKey, box: Sealed): Promise<T> {
  const pt = await subtle().decrypt({ name: "AES-GCM", iv: fromB64(box.iv) }, key, fromB64(box.ct));
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

/** A new vault for `pin` holding `data`, with the key that opens it. */
export async function createVault(pin: string, data: unknown): Promise<{ blob: VaultBlobV1; key: VaultKey }> {
  const salt = randomBytes(16);
  const key = await deriveKey(pin, salt);
  return { key, blob: { v: 1, salt: toB64(salt), rounds: PBKDF2_ROUNDS, check: await seal(key, CHECK), data: await seal(key, data) } };
}

/** The key for `pin`, or null when the PIN is wrong. Throws only for a damaged vault. */
export async function keyFor(blob: VaultBlobV1, pin: string): Promise<VaultKey | null> {
  const key = await deriveKey(pin, fromB64(blob.salt), blob.rounds);
  try {
    const check = await unseal<string>(key, blob.check);
    return check === CHECK ? key : null;
  } catch {
    return null;
  }
}

export function isVaultBlob(value: unknown): value is VaultBlob {
  const v = value as VaultBlob;
  // A vault claiming fewer rounds than the app uses would make guessing cheaper: refuse it.
  if (!v || typeof v.salt !== "string" || typeof v.rounds !== "number" || v.rounds < PBKDF2_ROUNDS || v.rounds > MAX_ROUNDS || !v.data?.iv) return false;
  if (v.v === 1) return !!v.check?.iv;
  if (v.v === 2) {
    return (
      (typeof v.pinWrap === "string" || (!!v.pinBox?.iv && !!v.pinBox?.ct)) &&
      (v.quickWrap === undefined || typeof v.quickWrap === "string") &&
      (v.bioWrap === undefined || typeof v.bioWrap === "string")
    );
  }
  return false;
}
