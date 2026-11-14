import { signal, Storage } from "nsh";
import { renew, logout as apiLogout } from "../api/auth";
import { AmpClient, AmpError } from "../api/client";
import type { AuthResponse } from "../api/types";
import { DeviceKey } from "ampmobile/native";
import {
  createVault,
  deriveKey,
  fromB64,
  importDataKey,
  isVaultBlob,
  keyFor,
  PBKDF2_ROUNDS,
  randomBytes,
  type Sealed,
  seal,
  toB64,
  unseal,
  type VaultBlob,
  type VaultBlobV2,
  type VaultKey,
} from "./vaultCrypto";

/** The device key store's keys for the vault: one used with the PIN, one for quick unlock. */
const BOUND_ALIAS = "amp.vault.bound";
const QUICK_ALIAS = "amp.vault.quick";

/** Whether this device keeps keys for the vault (Android 12+); never throws. */
function deviceAvailable(): boolean {
  try {
    return DeviceKey.available();
  } catch {
    return false;
  }
}

/**
 * Saved AMP servers and their sessions.
 *
 * What's on disk (NSH `Storage`, a JSON file in the app's private folder, which Android
 * also copies into backups): the server list without any secret, and, for servers kept
 * signed in, their session tokens sealed in a vault whose key comes from the app PIN
 * (see `vaultCrypto.ts`). No password and no plain token is ever written.
 *
 * In memory: every live session, tagged with a generation number. A renewal applies its
 * answer only if the session it renewed is still the current one, so a sign-out or a
 * fresh sign-in while it was in flight always wins.
 */
export interface SavedServer {
  id: string;
  /** What the user calls it; defaults to the host name. */
  name: string;
  serverUrl: string;
  username: string;
  /** Index into `SERVER_COLORS`. */
  color: number;
  /** Keep the session across launches (sealed in the vault, behind the PIN). */
  rememberMe: boolean;
}

/** Accent gradients a server card can wear, picked in turn as servers are added. */
export const SERVER_COLORS = [
  "bg-linear-to-br from-violet-500 to-fuchsia-500",
  "bg-linear-to-br from-sky-500 to-indigo-500",
  "bg-linear-to-br from-emerald-500 to-teal-600",
  "bg-linear-to-br from-amber-500 to-orange-600",
  "bg-linear-to-br from-rose-500 to-pink-600",
  "bg-linear-to-br from-cyan-500 to-blue-600",
] as const;

const SERVERS_KEY = "amp.servers";
const VAULT_KEY = "amp.vault";
const LOCKOUT_KEY = "amp.vault.lockout";
const SECURITY_KEY = "amp.security";

/** Wrong PINs before a wait, and the waits after each further one. The tenth erases the vault. */
const FREE_TRIES = 5;
const LOCKOUT_WAITS_S = [30, 60, 300, 900];
export const MAX_PIN_TRIES = 10;
/** Saved sessions are renewed when they have less than this left (or have run out). */
const RENEW_WITHIN_MS = 30 * 60_000;
const RENEW_CHECK_MS = 5 * 60_000;

export const servers = signal<SavedServer[]>([]);
/** False until the saved servers have been read at launch. */
export const serversReady = signal(false);
/** A vault (and so a PIN) exists. */
export const hasPin = signal(false);
/** The vault is closed: the lock screen shows and no session is in memory. */
export const locked = signal(false);
/** The vault is bound to this phone's key store (copies elsewhere can't be opened). */
export const bound = signal(false);
/** Sessions the user asked to keep are waiting for a PIN to be set before they can be saved. */
export const pinSetupNeeded = signal(false);
/** Seconds in the background before the app locks itself. */
export const autoLockSeconds = signal(30);

interface Session {
  token: string;
  expiration: string;
  /** Bumped by every sign-in, renewal and sign-out of this server. */
  gen: number;
}

const sessions = new Map<string, Session>();
/** Bumped whenever `sessions` changes, so screens that read a session update. */
const sessionsChanged = signal(0);
let changes = 0;
// Counted outside the signal: reading it here would subscribe whatever effect is running
// (the auto-lock's, say) to the very signal it then writes, and loop.
const touched = () => sessionsChanged.set(++changes);
const clients = new Map<string, AmpClient>();
let generation = 0;
let vaultBlob: VaultBlob | null = null;
/** The last vault write; the next one waits for it. */
let writes: Promise<void> = Promise.resolve();
/** Bumped by every lock: an unlock that started before one doesn't open the app. */
let lockEpoch = 0;
/** The unlock or PIN check in progress, so two never count wrong PINs at once. */
let pinCheck: Promise<unknown> = Promise.resolve();
/** Renewals in flight, one per server, shared by everyone who asks. */
const renewing = new Map<string, Promise<RenewOutcome>>();
let vaultKey: VaultKey | null = null;
/** A device-bound vault's data key, while unlocked (to give it its quick way in). */
let dataKeyRaw: Uint8Array | null = null;

export function serverById(id: string): SavedServer | undefined {
  return servers().find((s) => s.id === id);
}

/** The server's session while its token is still within its advertised expiry. */
export function sessionOf(server: SavedServer): { token: string; expiration: string } | null {
  sessionsChanged();
  const session = sessions.get(server.id);
  if (!session) return null;
  return Date.parse(session.expiration) > Date.now() ? session : null;
}

export function isSignedIn(server: SavedServer): boolean {
  return sessionOf(server) !== null;
}

/** The API client for a signed-in server. Throws when it has no valid session. */
export function clientFor(serverId: string): AmpClient {
  const server = serverById(serverId);
  if (!server) throw new Error("That server was removed");
  const session = sessionOf(server);
  if (!session) throw new AmpError("Sign in to this server again", 401);
  let client = clients.get(serverId);
  if (!client || client.baseUrl !== server.serverUrl || client.token !== session.token) {
    client = new AmpClient(server.serverUrl, session.token);
    clients.set(serverId, client);
  }
  return client;
}

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `${Date.now().toString(36)}-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// ---- Persistence -------------------------------------------------------------------------

/** The server list, with nothing secret in it. */
async function persistServers(): Promise<void> {
  await Storage.setItem(SERVERS_KEY, JSON.stringify(servers()));
}

/** The sessions kept across launches. */
function rememberedSessions(): Record<string, { token: string; expiration: string }> {
  const out: Record<string, { token: string; expiration: string }> = {};
  for (const s of servers()) {
    const session = sessions.get(s.id);
    if (s.rememberMe && session) out[s.id] = { token: session.token, expiration: session.expiration };
  }
  return out;
}

/**
 * Reseals the remembered sessions. Without a PIN they can't be saved, so the app asks
 * for one (`pinSetupNeeded`) and meanwhile keeps them in memory only. Locked: nothing to do.
 */
async function persistSessions(): Promise<void> {
  // One write at a time, each sealing what's current when its turn comes, so an older
  // write can never land after a newer one.
  const run = writes.then(async () => {
    if (locked()) return;
    const remembered = rememberedSessions();
    const key = vaultKey;
    const blob = vaultBlob;
    if (key && blob) {
      const sealed = { ...blob, data: await seal(key, remembered) };
      // Locked, erased or re-keyed meanwhile: this write is out of date.
      if (vaultKey !== key || vaultBlob !== blob) return;
      vaultBlob = sealed;
      await Storage.setItem(VAULT_KEY, JSON.stringify(sealed));
      return;
    }
    pinSetupNeeded.set(Object.keys(remembered).length > 0);
  });
  writes = run.catch(() => {});
  return run;
}

function update(id: string, change: (s: SavedServer) => SavedServer): void {
  servers.set(servers().map((s) => (s.id === id ? change(s) : s)));
}

function applySession(id: string, auth: { token: string; expiration: string }): void {
  clients.delete(id);
  sessions.set(id, { token: auth.token, expiration: auth.expiration, gen: ++generation });
  touched();
}

// ---- Signing in and out ------------------------------------------------------------------

/** Saves a newly signed-in server and returns its id. */
export async function addServer(input: {
  name: string;
  serverUrl: string;
  username: string;
  auth: AuthResponse;
  rememberMe: boolean;
}): Promise<string> {
  // The same account on the same panel again: refresh that entry rather than duplicate it.
  const same = servers().find(
    (s) => s.serverUrl.toLowerCase() === input.serverUrl.toLowerCase() && s.username.toLowerCase() === input.username.toLowerCase(),
  );
  if (same) {
    await setServerSession(same.id, input.username, input.auth, input.rememberMe);
    return same.id;
  }
  const id = newId();
  servers.set([
    ...servers(),
    {
      id,
      name: input.name.trim() || hostOf(input.serverUrl),
      serverUrl: input.serverUrl,
      username: input.username,
      color: servers().length % SERVER_COLORS.length,
      rememberMe: input.rememberMe,
    },
  ]);
  applySession(id, input.auth);
  await persistServers();
  await persistSessions();
  return id;
}

/** Stores a fresh sign-in for a saved server. */
export async function setServerSession(id: string, username: string, auth: AuthResponse, rememberMe: boolean): Promise<void> {
  update(id, (s) => ({ ...s, username, rememberMe }));
  applySession(id, auth);
  await persistServers();
  await persistSessions();
}

/** Forgets a server's session locally; called when a request comes back 401. */
export async function clearServerSession(id: string): Promise<void> {
  generation++;
  sessions.delete(id);
  clients.delete(id);
  touched();
  await persistSessions();
}

/** Signs out on the server (best effort) and forgets the session. */
export async function signOutServer(id: string): Promise<void> {
  const server = serverById(id);
  const session = sessions.get(id);
  // Forget it first, so nothing renews or reuses it while the server is told.
  await clearServerSession(id);
  if (server && session) {
    try {
      await apiLogout(new AmpClient(server.serverUrl, session.token));
    } catch {
      // Offline or already expired: the local session is gone either way.
    }
  }
}

export async function removeServer(id: string): Promise<void> {
  const server = serverById(id);
  const session = sessions.get(id);
  await clearServerSession(id);
  servers.set(servers().filter((s) => s.id !== id));
  await persistServers();
  await persistSessions();
  // Told last, without waiting: the server is gone from the app whatever the network does.
  if (server && session) {
    try {
      apiLogout(new AmpClient(server.serverUrl, session.token)).catch(() => {});
    } catch {
      // An address this version no longer accepts: nothing to tell.
    }
  }
}

// ---- Renewal -------------------------------------------------------------------------------

/**
 * Renews one session. It's tried even past the token's advertised expiry, since AMP
 * renews the session rather than the token. The answer is applied only if this is still
 * the session it renewed (no sign-out, sign-in or other renewal since, and not locked).
 */
type RenewOutcome = "renewed" | "rejected" | "failed" | "superseded";

function renewSession(id: string): Promise<RenewOutcome> {
  const running = renewing.get(id);
  if (running) return running;
  const run = renewOnce(id).finally(() => renewing.delete(id));
  renewing.set(id, run);
  return run;
}

async function renewOnce(id: string): Promise<RenewOutcome> {
  const server = serverById(id);
  const session = sessions.get(id);
  if (!server || !session) return "rejected";
  const gen = session.gen;
  const stillCurrent = () => !locked() && sessions.get(id)?.gen === gen;
  try {
    const fresh = await renew(new AmpClient(server.serverUrl, session.token));
    if (!stillCurrent()) return "superseded";
    if (typeof fresh?.token !== "string" || typeof fresh?.expiration !== "string") return "failed";
    applySession(id, fresh);
    await persistSessions();
    return "renewed";
  } catch (error) {
    if (error instanceof AmpError && error.isUnauthorized) {
      if (stillCurrent()) await clearServerSession(id);
      return "rejected";
    }
    return "failed";
  }
}

/**
 * A request for this server came back 401. The token may only have run out while AMP
 * still holds the session, so a renewal is tried first: "renewed" (try again), "signedOut"
 * (AMP refused, or there was no session: sign in again), "unreachable" (couldn't ask;
 * the session is kept) or "locked".
 */
export async function recoverSession(id: string): Promise<"renewed" | "signedOut" | "unreachable" | "locked"> {
  if (locked()) return "locked";
  if (!sessions.get(id)) return "signedOut";
  const outcome = await renewSession(id);
  if (outcome === "renewed" || outcome === "superseded") return sessions.get(id) ? "renewed" : "signedOut";
  if (outcome === "failed") return "unreachable";
  return "signedOut";
}

/** Renews every session, or only those near or past their expiry. */
async function renewSessions(all: boolean): Promise<void> {
  const due = [...sessions.entries()].filter(([, s]) => all || Date.parse(s.expiration) - Date.now() < RENEW_WITHIN_MS).map(([id]) => id);
  await Promise.all(due.map((id) => renewSession(id)));
}

let renewTimer: ReturnType<typeof setInterval> | undefined;
function startRenewing(): void {
  if (renewTimer) return;
  renewTimer = setInterval(() => {
    if (!locked()) renewSessions(false);
  }, RENEW_CHECK_MS);
}

// ---- The PIN and the vault -------------------------------------------------------------------

interface Lockout {
  failures: number;
  /** Epoch ms before which no PIN is tried. */
  until: number;
}

async function readLockout(): Promise<Lockout> {
  try {
    const raw = await Storage.getItem(LOCKOUT_KEY);
    const v = raw ? (JSON.parse(raw) as Lockout) : null;
    if (!v || typeof v.failures !== "number" || typeof v.until !== "number") return { failures: 0, until: 0 };
    // A clock set back would otherwise stretch a wait without end: never more than the longest.
    const longest = Date.now() + LOCKOUT_WAITS_S[LOCKOUT_WAITS_S.length - 1] * 1000;
    return { failures: Math.max(0, Math.floor(v.failures)), until: Math.min(v.until, longest) };
  } catch {
    // Unreadable (altered): count it as nearly used up rather than as fresh.
    return { failures: FREE_TRIES, until: 0 };
  }
}

/** Runs PIN checks one at a time. */
function onePinCheckAtATime<T>(work: () => Promise<T>): Promise<T> {
  const run = pinCheck.then(work, work);
  pinCheck = run.catch(() => {});
  return run;
}

/** Counts a wrong PIN; the tenth erases the vault. */
async function countWrongPin(lockout: Lockout): Promise<UnlockResult> {
  const failures = lockout.failures + 1;
  if (failures >= MAX_PIN_TRIES) {
    await eraseVault();
    return { ok: false, wrong: true, triesLeft: 0, waitSeconds: 0, erased: true };
  }
  const wait = failures >= FREE_TRIES ? LOCKOUT_WAITS_S[Math.min(failures - FREE_TRIES, LOCKOUT_WAITS_S.length - 1)] : 0;
  await Storage.setItem(LOCKOUT_KEY, JSON.stringify({ failures, until: Date.now() + wait * 1000 }));
  return { ok: false, wrong: true, triesLeft: MAX_PIN_TRIES - failures, waitSeconds: wait, erased: false };
}

/** Sets the first PIN and seals the sessions waiting to be kept. */
export async function setupPin(pin: string): Promise<void> {
  validatePin(pin);
  const made = await newVault(pin, rememberedSessions());
  vaultBlob = made.blob;
  vaultKey = made.key;
  dataKeyRaw = made.raw;
  await Storage.setItem(VAULT_KEY, JSON.stringify(made.blob));
  await Storage.removeItem(LOCKOUT_KEY);
  hasPin.set(true);
  bound.set(made.blob.v === 2);
  pinSetupNeeded.set(false);
}

/** Keeps this session's sign-ins in memory only: they're not saved, and nobody asks again for them. */
export async function declinePin(): Promise<void> {
  servers.set(servers().map((s) => (s.rememberMe && !hasPin() ? { ...s, rememberMe: false } : s)));
  pinSetupNeeded.set(false);
  await persistServers();
}

export type UnlockResult =
  | { ok: true }
  | { ok: false; wrong: boolean; triesLeft: number; waitSeconds: number; erased: boolean; deviceLost?: boolean };

/** Seconds until another PIN may be tried (0: now). */
export async function lockoutRemaining(): Promise<number> {
  const l = await readLockout();
  return Math.max(0, Math.ceil((l.until - Date.now()) / 1000));
}

/**
 * Opens the vault. Wrong PINs are counted on disk (so restarting doesn't reset them):
 * after five, each try waits longer; the tenth erases the saved sign-ins.
 */
export function unlock(pin: string): Promise<UnlockResult> {
  return onePinCheckAtATime(async () => {
    const blob = vaultBlob;
    if (!blob || !locked()) return { ok: true } as UnlockResult;
    const epoch = lockEpoch;
    const lockout = await readLockout();
    if (lockout.until > Date.now()) {
      return { ok: false, wrong: false, triesLeft: MAX_PIN_TRIES - lockout.failures, waitSeconds: Math.ceil((lockout.until - Date.now()) / 1000), erased: false };
    }
    let opened: { key: VaultKey; raw: Uint8Array | null } | null;
    try {
      opened = await openWithPin(blob, pin);
    } catch (e) {
      // The device's key is gone (a reset, or this file came from another phone): what it
      // sealed can never be opened, so the saved sign-ins are cleared.
      if (String((e as Error).message).startsWith("device:")) {
        await eraseVault();
        return { ok: false, wrong: false, triesLeft: 0, waitSeconds: 0, erased: true, deviceLost: true };
      }
      throw e;
    }
    if (!opened) return countWrongPin(lockout);
    await Storage.removeItem(LOCKOUT_KEY);
    if (epoch !== lockEpoch || vaultBlob !== blob) return { ok: false, wrong: false, triesLeft: MAX_PIN_TRIES, waitSeconds: 0, erased: false };
    await finishUnlock(blob, opened.key, opened.raw);
    // A PIN-only vault moves to a device-bound one at the first chance.
    if (blob.v === 1 && deviceAvailable()) await rebuildVault(pin);
    return { ok: true } as UnlockResult;
  });
}

/**
 * Opens the vault without the PIN: works only within a minute of the phone being
 * unlocked (fingerprint, face or the phone's own PIN), on the phone that sealed it.
 * False when it can't (the lock screen then asks for the PIN).
 */
export function quickUnlock(): Promise<boolean> {
  return onePinCheckAtATime(async () => {
    const blob = vaultBlob;
    if (!blob || blob.v !== 2 || !blob.quickWrap || !locked()) return false;
    const epoch = lockEpoch;
    let raw: Uint8Array;
    try {
      raw = fromB64(await DeviceKey.open(QUICK_ALIAS, blob.quickWrap));
    } catch (e) {
      const why = String((e as Error)?.message ?? e);
      // Not unlocked recently: just ask for the PIN. A key that's gone or invalidated
      // (the phone's lock was changed): drop the quick way in; the PIN still works.
      if (!why.startsWith("auth")) {
        const { quickWrap: _gone, ...rest } = blob;
        vaultBlob = rest;
        await Storage.setItem(VAULT_KEY, JSON.stringify(rest));
      }
      return false;
    }
    if (epoch !== lockEpoch || vaultBlob !== blob) return false;
    await finishUnlock(blob, await importDataKey(raw), raw);
    return true;
  });
}

/** Whether the lock screen may try `quickUnlock`. */
export function canQuickUnlock(): boolean {
  return !!vaultBlob && vaultBlob.v === 2 && !!vaultBlob.quickWrap;
}

/** The vault's key from the PIN, or null for a wrong PIN; throws "device: …" when the device's key is gone. */
async function openWithPin(blob: VaultBlob, pin: string): Promise<{ key: VaultKey; raw: Uint8Array | null } | null> {
  if (blob.v === 1) {
    const key = await keyFor(blob, pin);
    return key ? { key, raw: null } : null;
  }
  let pinBox: Sealed;
  try {
    pinBox = JSON.parse(atob(await DeviceKey.open(BOUND_ALIAS, blob.pinWrap)));
  } catch (e) {
    throw new Error(`device: ${String((e as Error)?.message ?? e)}`);
  }
  const pinKey = await deriveKey(pin, fromB64(blob.salt), blob.rounds);
  let rawB64: string;
  try {
    rawB64 = await unseal<string>(pinKey, pinBox);
  } catch {
    return null; // GCM refuses a wrong key: a wrong PIN
  }
  const raw = fromB64(rawB64);
  return { key: await importDataKey(raw), raw };
}

/** Takes the sessions out of an opened vault and unlocks the app. */
async function finishUnlock(blob: VaultBlob, key: VaultKey, raw: Uint8Array | null): Promise<void> {
  let saved: Record<string, { token: string; expiration: string }> = {};
  try {
    saved = await unseal(key, blob.data);
  } catch {
    // The sessions can't be read (altered on disk): start them afresh behind the same PIN.
    saved = {};
  }
  vaultKey = key;
  dataKeyRaw = raw;
  for (const [id, s] of Object.entries(saved ?? {})) {
    if (serverById(id) && typeof s?.token === "string" && typeof s?.expiration === "string") applySession(id, s);
  }
  locked.set(false);
  await persistSessions();
  await addQuickWrap();
  renewSessions(true);
}

/**
 * Gives a device-bound vault its quick way in, if it has none yet. The quick key only
 * works within a minute of the phone being unlocked, sealing included, so this is tried
 * at every unlock until it succeeds.
 */
async function addQuickWrap(): Promise<void> {
  const blob = vaultBlob;
  if (!blob || blob.v !== 2 || blob.quickWrap || !dataKeyRaw) return;
  try {
    const quickWrap = await DeviceKey.seal(QUICK_ALIAS, toB64(dataKeyRaw), true);
    if (vaultBlob !== blob) return;
    vaultBlob = { ...blob, quickWrap };
    await Storage.setItem(VAULT_KEY, JSON.stringify(vaultBlob));
  } catch {
    // Not unlocked recently enough, or no screen lock: next time.
  }
}

/** A new vault for `pin`: bound to the device where it can be, PIN-only otherwise. */
async function newVault(pin: string, data: unknown): Promise<{ blob: VaultBlob; key: VaultKey; raw: Uint8Array | null }> {
  if (!deviceAvailable()) {
    const { blob, key } = await createVault(pin, data);
    return { blob, key, raw: null };
  }
  const raw = randomBytes(32);
  const key = await importDataKey(raw);
  const salt = randomBytes(16);
  const pinKey = await deriveKey(pin, salt);
  const pinBox = await seal(pinKey, toB64(raw));
  let pinWrap: string;
  try {
    pinWrap = await DeviceKey.seal(BOUND_ALIAS, btoa(JSON.stringify(pinBox)), false);
  } catch {
    // The key store refused: the PIN-only vault still protects the sessions.
    const fallback = await createVault(pin, data);
    return { blob: fallback.blob, key: fallback.key, raw: null };
  }
  const blob: VaultBlobV2 = { v: 2, salt: toB64(salt), rounds: PBKDF2_ROUNDS, pinWrap, data: await seal(key, data) };
  return { blob, key, raw };
}

/** Re-makes the vault (a new PIN, or moving to a device-bound one), keeping the sessions. */
async function rebuildVault(pin: string): Promise<void> {
  const made = await newVault(pin, rememberedSessions());
  vaultBlob = made.blob;
  vaultKey = made.key;
  dataKeyRaw = made.raw;
  await Storage.setItem(VAULT_KEY, JSON.stringify(made.blob));
  bound.set(made.blob.v === 2);
  await addQuickWrap();
}

/** Closes the vault: every session leaves memory until the PIN is entered again. */
export function lockNow(): void {
  if (!hasPin()) return;
  lockEpoch++;
  generation++;
  vaultKey = null;
  dataKeyRaw = null;
  sessions.clear();
  clients.clear();
  touched();
  locked.set(true);
}

/** Changes the PIN; the sessions are resealed under the new one. */
export function changePin(oldPin: string, newPin: string): Promise<boolean> {
  return onePinCheckAtATime(async () => {
    const current = vaultBlob;
    if (!current || locked()) return false;
    validatePin(newPin);
    // Wrong current PINs count here too, and wait the same way.
    const lockout = await readLockout();
    if (lockout.until > Date.now()) throw new Error(`Too many wrong PINs. Try again in ${Math.ceil((lockout.until - Date.now()) / 1000)} s.`);
    let opened: { key: VaultKey; raw: Uint8Array | null } | null;
    try {
      opened = await openWithPin(current, oldPin);
    } catch {
      throw new Error("This phone's key for the saved sign-ins is gone. Remove the PIN and sign in again.");
    }
    if (!opened) {
      const result = await countWrongPin(lockout);
      if (!result.ok && result.erased) throw new Error("Too many wrong PINs: the PIN and saved sign-ins were erased.");
      return false;
    }
    if (vaultBlob !== current) return false;
    await rebuildVault(newPin);
    await Storage.removeItem(LOCKOUT_KEY);
    return true;
  });
}

/**
 * Forgets the PIN and every saved sign-in (the "Forgot PIN" way out, and what ten wrong
 * PINs do). Servers stay in the list, signed out.
 */
export async function eraseVault(): Promise<void> {
  lockEpoch++;
  generation++;
  vaultBlob = null;
  vaultKey = null;
  dataKeyRaw = null;
  if (deviceAvailable()) {
    DeviceKey.forget(BOUND_ALIAS).catch(() => {});
    DeviceKey.forget(QUICK_ALIAS).catch(() => {});
  }
  sessions.clear();
  clients.clear();
  touched();
  servers.set(servers().map((s) => ({ ...s, rememberMe: false })));
  await Storage.removeItem(VAULT_KEY);
  await Storage.removeItem(LOCKOUT_KEY);
  await persistServers();
  hasPin.set(false);
  bound.set(false);
  locked.set(false);
  pinSetupNeeded.set(false);
}

export function validatePin(pin: string): void {
  if (!/^\d{6,12}$/.test(pin)) throw new Error("Use 6 to 12 digits");
  if (/^(\d)\1+$/.test(pin) || "01234567890123".includes(pin) || "98765432109876".includes(pin)) {
    throw new Error("That PIN is too easy to guess");
  }
}

export async function setAutoLock(seconds: number): Promise<void> {
  seconds = Math.min(3600, Math.max(0, Math.floor(seconds)));
  autoLockSeconds.set(seconds);
  await Storage.setItem(SECURITY_KEY, JSON.stringify({ autoLockSeconds: seconds }));
}

// ---- Launch ----------------------------------------------------------------------------------

/**
 * Launch: reads the server list and the vault. With a vault the app starts locked. A
 * token left in plain text by an older version is moved into memory and scrubbed from
 * disk at once; the app then asks for a PIN to keep it.
 */
export async function loadServers(): Promise<void> {
  // Each part is read on its own, so a damaged one never takes the others with it.
  try {
    const rawVault = await Storage.getItem(VAULT_KEY);
    const parsedVault = rawVault ? JSON.parse(rawVault) : null;
    if (isVaultBlob(parsedVault)) {
      vaultBlob = parsedVault;
      hasPin.set(true);
      bound.set(parsedVault.v === 2);
      locked.set(true);
    }
  } catch {
    // An unreadable vault is left on disk untouched; there's nothing to unlock.
  }

  try {
    const rawSecurity = await Storage.getItem(SECURITY_KEY);
    const security = rawSecurity ? JSON.parse(rawSecurity) : null;
    const secs = Number(security?.autoLockSeconds);
    if (Number.isFinite(secs)) autoLockSeconds.set(Math.min(3600, Math.max(0, Math.floor(secs))));
  } catch {
    // Keep the default.
  }

  let migrated = false;
  try {
    const raw = await Storage.getItem(SERVERS_KEY);
    const saved = raw ? JSON.parse(raw) : [];
    const list: SavedServer[] = [];
    const seen = new Set<string>();
    for (const s of Array.isArray(saved) ? saved : []) {
      if (!s || typeof s.id !== "string" || !s.id || typeof s.serverUrl !== "string" || seen.has(s.id)) continue;
      seen.add(s.id);
      list.push({
        id: s.id,
        name: String(s.name ?? "").slice(0, 100),
        serverUrl: s.serverUrl,
        username: String(s.username ?? ""),
        color: Math.abs(Math.floor(Number(s.color) || 0)) % SERVER_COLORS.length,
        rememberMe: !!s.rememberMe,
      });
      // An older version's plain-text token: into memory, never back to disk.
      if (typeof s.token === "string") {
        migrated = true;
        if (!vaultBlob && typeof s.expiration === "string") applySession(s.id, { token: s.token, expiration: s.expiration });
      }
    }
    servers.set(list);
    if (migrated) await persistServers();
  } catch {
    // An unreadable list: shown empty, and left on disk until something is saved.
    servers.set([]);
  } finally {
    serversReady.set(true);
  }

  startRenewing();
  if (!locked()) {
    await persistSessions();
    renewSessions(true);
  }
}
