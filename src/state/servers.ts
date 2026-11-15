import { signal, Storage } from "nsh";
import { renew, logout as apiLogout } from "../api/auth";
import { AmpClient, AmpError, normalizeServerUrl } from "../api/client";
import type { AuthResponse } from "../api/types";
import { deviceKeysAvailable, deviceMacAvailable, deviceStatus, forgetKey, macWith, openWith, type PromptText, sealWith } from "../lib/deviceKeys";
import {
  createVault,
  deriveBits,
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
import { loadPrivacy } from "../lib/privacy";
import { crashWatch, handOverToken, refreshCrashWatch, unwatchAll, unwatchServer } from "../lib/crashWatch";

/** The device key store's keys for the vault: one used with the PIN, one for quick unlock, one for fingerprint unlock. */
const BOUND_ALIAS = "amp.vault.bound";
const QUICK_ALIAS = "amp.vault.quick";
const BIO_ALIAS = "amp.vault.bio";
/** The phone's HMAC key that the PIN's key is made with: without the phone, a PIN guess can't be checked. */
const PEPPER_ALIAS = "amp.vault.pepper";

const UNLOCK_PROMPT: PromptText = { title: "Unlock AMP Mobile", subtitle: "Your saved servers", cancel: "Use PIN" };

/**
 * Saved AMP servers and their sessions.
 *
 * What's on disk (NSH `Storage`, a JSON file in the app's private folder, left out of
 * Android's backups): the server list without any secret, and, for servers kept signed
 * in, their session tokens sealed in a vault opened by the app PIN, and on Android also
 * by quick or fingerprint unlock (see `vaultCrypto.ts` and `src/lib/deviceKeys.ts`). No
 * password and no plain token is ever written.
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
/** Fingerprint or face unlock is on: the vault has a way in sealed by a biometric key. */
export const biometricOn = signal(false);
/** Why fingerprint unlock just turned itself off (a fingerprint was added to the phone), for the lock screen. */
export const biometricNotice = signal<string | null>(null);
/**
 * Quick unlock is on: for a minute after the phone itself is unlocked, the app opens without
 * its PIN. Off until the user turns it on, since anyone who knows the phone's own PIN or
 * pattern (or is handed it just unlocked) would otherwise get in without the app's PIN.
 */
export const quickUnlockOn = signal(false);
/** The phone's key store refused the vault key, so saved sign-ins rely on the PIN alone (the Security page says so). */
export const keyStoreRefused = signal(false);
/** Something to tell the user once the app is open: the saved sign-ins couldn't be read. */
export const vaultNotice = signal<string | null>(null);
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
/** Key store deletions from the last erase: a new vault waits for them, or they'd delete its fresh keys. */
let forgetting: Promise<unknown> = Promise.resolve();
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

/**
 * `clientFor` for a one-off read a page starts as it opens: a missing session becomes a
 * rejected promise instead of an error thrown while the page is drawn.
 */
export function clientLater(serverId: string): Promise<AmpClient> {
  return Promise.resolve().then(() => clientFor(serverId));
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
    // A few rounds at most: each one only repeats because a way in was added or removed
    // (quick or fingerprint unlock) while the sessions were being sealed.
    for (let round = 0; round < 5; round++) {
      if (locked()) return;
      const remembered = rememberedSessions();
      const key = vaultKey;
      const blob = vaultBlob;
      if (!key || !blob) {
        pinSetupNeeded.set(Object.keys(remembered).length > 0);
        return;
      }
      const data = await seal(key, remembered);
      // Locked, erased or re-keyed meanwhile: this write is out of date.
      if (vaultKey !== key || !vaultBlob) return;
      // Same key, but the vault around it changed: seal again onto the current one, so the
      // new sessions aren't lost and the change isn't undone.
      if (vaultBlob !== blob) continue;
      vaultBlob = { ...blob, data };
      await Storage.setItem(VAULT_KEY, JSON.stringify(vaultBlob));
      return;
    }
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
  // Crash alerts check in the background with the same session: they get every fresh token.
  if (serverById(id)?.rememberMe) void handOverToken(id, auth);
}

// ---- Signing in and out ------------------------------------------------------------------

/**
 * A sign-in that finished after the app locked: no session may be in memory while locked,
 * so it's dropped (and the server told) and the user signs in again after unlocking.
 */
function refuseWhileLocked(serverUrl: string, auth: AuthResponse): void {
  if (!locked()) return;
  try {
    apiLogout(new AmpClient(serverUrl, auth.token)).catch(() => {});
  } catch {
    // An address that can't be used: nothing to tell.
  }
  throw new Error("The app locked while signing in. Sign in again.");
}

/** Saves a newly signed-in server and returns its id. */
export async function addServer(input: {
  name: string;
  serverUrl: string;
  username: string;
  auth: AuthResponse;
  rememberMe: boolean;
}): Promise<string> {
  refuseWhileLocked(input.serverUrl, input.auth);
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
  refuseWhileLocked(serverById(id)?.serverUrl ?? "", auth);
  update(id, (s) => ({ ...s, username, rememberMe }));
  applySession(id, auth);
  // Not staying signed in: no session may outlive the app, the crash alerts' included.
  if (!rememberMe) await unwatchServer(id);
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
  await unwatchServer(id);
  if (server && session) {
    try {
      await apiLogout(new AmpClient(server.serverUrl, session.token));
    } catch {
      // Offline or already expired: the local session is gone either way.
    }
  }
}

/** Moves a server one place up (-1) or down (1) in the list. */
export function moveServer(id: string, delta: -1 | 1): void {
  const list = [...servers()];
  const from = list.findIndex((s) => s.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= list.length) return;
  [list[from], list[to]] = [list[to], list[from]];
  servers.set(list);
  persistServers().catch(() => {});
}

export interface ServerListEntry {
  name: string;
  serverUrl: string;
  username: string;
}

/** The saved servers as text to carry to another phone: names, addresses and user names, nothing secret. */
export function serverListText(): string {
  return JSON.stringify({ app: "AMP Mobile", version: 1, servers: servers().map((s) => ({ name: s.name, serverUrl: s.serverUrl, username: s.username })) }, null, 2);
}

/** Reads a server list written by `serverListText`: only addresses the app accepts are kept, 50 at most. */
export function parseServerList(text: string): { entries: ServerListEntry[]; error?: string } {
  const notAList = "The clipboard doesn't hold a server list. Use Copy list on the other phone.";
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { entries: [], error: notAList };
  }
  const raw = Array.isArray(data) ? data : (data as { servers?: unknown } | null)?.servers;
  if (!Array.isArray(raw)) return { entries: [], error: notAList };
  const entries: ServerListEntry[] = [];
  for (const item of raw.slice(0, 50)) {
    const e = item as Partial<ServerListEntry> | null;
    if (typeof e?.serverUrl !== "string") continue;
    try {
      entries.push({ name: String(e.name ?? "").slice(0, 100), serverUrl: normalizeServerUrl(e.serverUrl), username: String(e.username ?? "").slice(0, 100) });
    } catch {
      // Not an address this app accepts: left out.
    }
  }
  return entries.length ? { entries } : { entries: [], error: "No valid server addresses were found in the clipboard." };
}

/** Adds servers from a list, signed out; ones already saved (same address and user) are skipped. */
export async function addServersFromList(entries: ServerListEntry[]): Promise<{ added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;
  const next = [...servers()];
  for (const e of entries) {
    if (next.some((s) => s.serverUrl.toLowerCase() === e.serverUrl.toLowerCase() && s.username.toLowerCase() === e.username.toLowerCase())) {
      skipped++;
      continue;
    }
    next.push({ id: newId(), name: e.name.trim() || hostOf(e.serverUrl), serverUrl: e.serverUrl, username: e.username, color: next.length % SERVER_COLORS.length, rememberMe: false });
    added++;
  }
  servers.set(next);
  await persistServers();
  return { added, skipped };
}

export async function removeServer(id: string): Promise<void> {
  const server = serverById(id);
  const session = sessions.get(id);
  await clearServerSession(id);
  await unwatchServer(id);
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
    // An unreadable expiry would count the session as over at once (as at sign-in).
    if (typeof fresh?.token !== "string" || typeof fresh?.expiration !== "string" || Number.isNaN(Date.parse(fresh.expiration))) return "failed";
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
  biometricOn.set(false);
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
    // A PIN-only vault, or a phone-bound one without the HMAC, moves to the strongest kind this phone makes.
    const upgrade = blob.v === 1 ? await deviceKeysAvailable() : !blob.pinBox && (await deviceMacAvailable());
    if (upgrade && !locked()) await rebuildVault(pin);
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
    // Before the server list is read, the sessions would have no server to go to, and be lost.
    if (!quickUnlockOn() || !serversReady() || quickHeldBack() || !blob || blob.v !== 2 || !blob.quickWrap || !locked()) return false;
    const epoch = lockEpoch;
    let raw: Uint8Array;
    try {
      raw = fromB64(await openWith(QUICK_ALIAS, blob.quickWrap));
    } catch (e) {
      const why = String((e as Error)?.message ?? e);
      // Not unlocked recently: just ask for the PIN. A key that's gone or invalidated
      // (the phone's lock was changed): drop the quick way in; the PIN still works.
      if ((why.startsWith("missing") || why.startsWith("invalid")) && vaultBlob === blob && epoch === lockEpoch) {
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
  return quickUnlockOn() && serversReady() && !quickHeldBack() && !!vaultBlob && vaultBlob.v === 2 && !!vaultBlob.quickWrap;
}

/** Whether the lock screen may offer the fingerprint prompt. */
export function canBiometricUnlock(): boolean {
  return serversReady() && biometricOn() && !!vaultBlob && vaultBlob.v === 2 && !!vaultBlob.bioWrap;
}

/**
 * Opens the vault with a fingerprint or face: the phone's prompt unlocks the biometric key
 * for one use. "ok", "cancelled" (closed, or "Use PIN"), or "failed" with the reason.
 */
export function biometricUnlock(): Promise<{ result: "ok" | "cancelled" | "failed"; message?: string }> {
  return onePinCheckAtATime(async () => {
    const blob = vaultBlob;
    if (!serversReady() || !blob || blob.v !== 2 || !blob.bioWrap || !locked()) return { result: "cancelled" as const };
    const epoch = lockEpoch;
    let raw: Uint8Array;
    try {
      raw = fromB64(await openWith(BIO_ALIAS, blob.bioWrap, UNLOCK_PROMPT));
    } catch (e) {
      const why = String((e as Error)?.message ?? e);
      if (why.startsWith("cancel") || why.startsWith("busy")) return { result: "cancelled" as const };
      if ((why.startsWith("invalid") || why.startsWith("missing")) && vaultBlob === blob && epoch === lockEpoch) {
        // A fingerprint or face was added to the phone (or the key is gone): that voids the
        // key for good. The PIN still opens the vault; the user turns this on again after.
        await dropBiometric(blob);
        const notice = "Fingerprint unlock turned off because the phone's fingerprints or face changed. Enter your PIN, then turn it on again in Security.";
        biometricNotice.set(notice);
        return { result: "failed" as const, message: notice };
      }
      if (why.startsWith("lockout")) return { result: "failed" as const, message: "Too many tries. Enter your PIN." };
      return { result: "failed" as const, message: "Fingerprint unlock didn't work. Enter your PIN." };
    }
    if (epoch !== lockEpoch || vaultBlob !== blob) return { result: "cancelled" as const };
    await finishUnlock(blob, await importDataKey(raw), raw);
    biometricNotice.set(null);
    return { result: "ok" as const };
  });
}

/** Takes the biometric way in out of `blob` (if it's still the vault) and forgets its key. */
async function dropBiometric(blob: VaultBlobV2): Promise<void> {
  const { bioWrap: _gone, ...rest } = blob;
  vaultBlob = rest;
  biometricOn.set(false);
  await Storage.setItem(VAULT_KEY, JSON.stringify(rest));
  await forgetKey(BIO_ALIAS);
}

/** Whether this phone can turn fingerprint unlock on now: "ready", "notEnrolled", "unavailable" or "notBound". */
export async function biometricChoice(): Promise<"ready" | "notEnrolled" | "unavailable" | "notBound"> {
  const status = await deviceStatus();
  if (status.biometric !== "ready") return status.biometric;
  return vaultBlob?.v === 2 ? "ready" : "notBound";
}

/**
 * Turns fingerprint unlock on (the prompt asks for a fingerprint or face first) or off.
 * While it's on, the lock screen asks for a fingerprint instead of opening by itself after
 * the phone is unlocked. Throws with a message for the screen.
 */
export async function setBiometricUnlock(on: boolean): Promise<void> {
  const blob = vaultBlob;
  if (!blob || blob.v !== 2 || locked() || !dataKeyRaw) throw new Error("Fingerprint unlock needs the saved sign-ins locked to this phone. Set a PIN first.");
  if (!on) {
    if (blob.bioWrap) await dropBiometric(blob);
    biometricOn.set(false);
    await addQuickWrap();
    return;
  }
  const epoch = lockEpoch;
  const raw = dataKeyRaw;
  let bioWrap: string;
  try {
    bioWrap = await sealWith(BIO_ALIAS, toB64(raw), "biometric", { title: "Turn on fingerprint unlock", subtitle: "Confirm it's you", cancel: "Cancel" });
  } catch (e) {
    const why = String((e as Error)?.message ?? e);
    if (why.startsWith("cancel")) throw new Error("Not turned on.");
    if (why.startsWith("lockout")) throw new Error("Too many tries. Try again later.");
    throw new Error("This phone couldn't turn fingerprint unlock on.");
  }
  // Locked, erased or re-keyed meanwhile: what was sealed belongs to a vault that's gone.
  // (A session saved meanwhile only replaced the sessions: the current vault takes it.)
  const current = vaultBlob;
  if (epoch !== lockEpoch || dataKeyRaw !== raw || !current || current.v !== 2) {
    await forgetKey(BIO_ALIAS);
    throw new Error("The app locked meanwhile. Try again.");
  }
  // The quick way in would open the app without a fingerprint: it goes while this is on.
  const { quickWrap: _quick, ...rest } = current;
  vaultBlob = { ...rest, bioWrap };
  await Storage.setItem(VAULT_KEY, JSON.stringify(vaultBlob));
  biometricOn.set(true);
  biometricNotice.set(null);
}

/**
 * A key store error while opening the vault. Only a key that's gone or voided is lost for good;
 * anything else (no answer, a busy key store) is worth another try, and must never erase the vault.
 */
function keyStoreFailure(e: unknown): never {
  const why = String((e as Error)?.message ?? e);
  if (why.startsWith("missing") || why.startsWith("invalid")) throw new Error(`device: ${why}`);
  throw new Error("The phone's key store didn't answer. Try again.");
}

/** The vault's key from the PIN, or null for a wrong PIN; throws "device: …" when the device's key is gone. */
async function openWithPin(blob: VaultBlob, pin: string): Promise<{ key: VaultKey; raw: Uint8Array | null } | null> {
  if (blob.v === 1) {
    const key = await keyFor(blob, pin);
    return key ? { key, raw: null } : null;
  }
  let pinBox: Sealed;
  let pinKey: VaultKey;
  if (blob.pinBox) {
    // The key is made from the PIN and the phone's HMAC of it, so a guess can't be checked off the phone.
    const bits = await deriveBits(pin, fromB64(blob.salt), blob.rounds);
    try {
      pinKey = await importDataKey(fromB64(await macWith(PEPPER_ALIAS, toB64(bits), false)));
    } catch (e) {
      keyStoreFailure(e);
    }
    pinBox = blob.pinBox;
  } else {
    try {
      pinBox = JSON.parse(atob(await openWith(BOUND_ALIAS, blob.pinWrap!)));
    } catch (e) {
      keyStoreFailure(e);
    }
    pinKey = await deriveKey(pin, fromB64(blob.salt), blob.rounds);
  }
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
    // The sessions can't be read (altered on disk): start them afresh behind the same PIN, and say so.
    saved = {};
    vaultNotice.set("The file that holds them was changed or damaged, so they were cleared. Sign in to your servers again.");
  }
  vaultKey = key;
  dataKeyRaw = raw;
  for (const [id, s] of Object.entries(saved ?? {})) {
    if (serverById(id) && typeof s?.token === "string" && typeof s?.expiration === "string") applySession(id, s);
  }
  locked.set(false);
  biometricNotice.set(null);
  await persistSessions();
  // Quick unlock is the user's choice: a vault that still carries its way in from before it was
  // opt-in (or from a setting since turned off) loses it here.
  if (quickUnlockOn()) await addQuickWrap();
  else await dropQuickWrap();
  renewSessions(true);
}

/**
 * Gives a device-bound vault its quick way in, if the user turned quick unlock on and it has
 * none yet. The quick key only works within a minute of the phone being unlocked, sealing
 * included, so this is tried at every unlock until it succeeds.
 */
async function addQuickWrap(): Promise<void> {
  const blob = vaultBlob;
  if (!quickUnlockOn() || !blob || blob.v !== 2 || blob.quickWrap || blob.bioWrap || !dataKeyRaw) return;
  try {
    const quickWrap = await sealWith(QUICK_ALIAS, toB64(dataKeyRaw), "quick");
    // Turned off, or the vault changed, while it was being sealed: this one is out of date.
    if (vaultBlob !== blob || !quickUnlockOn()) return;
    vaultBlob = { ...blob, quickWrap };
    await Storage.setItem(VAULT_KEY, JSON.stringify(vaultBlob));
  } catch {
    // Not unlocked recently enough, or no screen lock: next time.
  }
}

/** Takes the quick way in out of the vault (if it has one) and forgets its key. */
async function dropQuickWrap(): Promise<void> {
  const blob = vaultBlob;
  if (!blob || blob.v !== 2 || !blob.quickWrap) return;
  const { quickWrap: _gone, ...rest } = blob;
  vaultBlob = rest;
  await Storage.setItem(VAULT_KEY, JSON.stringify(rest));
  await forgetKey(QUICK_ALIAS);
}

/**
 * Turns quick unlock on or off. Turning it off removes its way in and deletes its key. Turned
 * on, its way in is sealed at once if the phone was unlocked in the last minute, otherwise at
 * the next unlock. Throws with a message for the screen.
 */
export async function setQuickUnlock(on: boolean): Promise<void> {
  if (on) {
    const blob = vaultBlob;
    if (!blob || blob.v !== 2 || locked() || !dataKeyRaw) throw new Error("Quick unlock needs the saved sign-ins locked to this phone. Set a PIN first.");
    if (blob.bioWrap) throw new Error("Fingerprint unlock is on, and it replaces quick unlock.");
  }
  quickUnlockOn.set(on);
  await persistSecurity();
  if (on) await addQuickWrap();
  else await dropQuickWrap();
}

/**
 * A new vault for `pin`: bound to the device where it can be, PIN-only otherwise. `keep`:
 * the data key of the vault it replaces (a new PIN), so the ways in sealed around that key
 * (fingerprint unlock) stay good.
 */
async function newVault(pin: string, data: unknown, keep: Uint8Array | null = null): Promise<{ blob: VaultBlob; key: VaultKey; raw: Uint8Array | null }> {
  if (!(await deviceKeysAvailable())) {
    const { blob, key } = await createVault(pin, data);
    return { blob, key, raw: null };
  }
  await forgetting;
  const raw = keep ?? randomBytes(32);
  const key = await importDataKey(raw);
  const salt = randomBytes(16);
  if (await deviceMacAvailable()) {
    try {
      const bits = await deriveBits(pin, salt);
      const pepperedKey = await importDataKey(fromB64(await macWith(PEPPER_ALIAS, toB64(bits), true)));
      const blob: VaultBlobV2 = { v: 2, salt: toB64(salt), rounds: PBKDF2_ROUNDS, pinBox: await seal(pepperedKey, toB64(raw)), data: await seal(key, data) };
      keyStoreRefused.set(false);
      return { blob, key, raw };
    } catch {
      // The key store couldn't make the HMAC key: the older phone-bound kind below is tried next.
    }
  }
  const pinKey = await deriveKey(pin, salt);
  const pinBox = await seal(pinKey, toB64(raw));
  let pinWrap: string;
  try {
    pinWrap = await sealWith(BOUND_ALIAS, btoa(JSON.stringify(pinBox)), "bound");
  } catch {
    // The key store refused: the PIN-only vault still protects the sessions, and the Security page says it's weaker.
    keyStoreRefused.set(true);
    const fallback = await createVault(pin, data);
    return { blob: fallback.blob, key: fallback.key, raw: null };
  }
  const blob: VaultBlobV2 = { v: 2, salt: toB64(salt), rounds: PBKDF2_ROUNDS, pinWrap, data: await seal(key, data) };
  return { blob, key, raw };
}

/** Re-makes the vault (a new PIN, or moving to a device-bound one), keeping the sessions. */
async function rebuildVault(pin: string): Promise<void> {
  const epoch = lockEpoch;
  const before = vaultBlob;
  // A device-bound vault keeps its data key, so fingerprint unlock survives a new PIN.
  const keep = before?.v === 2 && before.bioWrap ? dataKeyRaw : null;
  const made = await newVault(pin, rememberedSessions(), keep);
  // Locked or erased while the new vault was made: the old one stands (and no key stays in memory).
  if (epoch !== lockEpoch || vaultBlob !== before) return;
  if (keep && made.raw === keep && made.blob.v === 2 && before?.v === 2 && before.bioWrap) made.blob.bioWrap = before.bioWrap;
  biometricOn.set(made.blob.v === 2 && !!made.blob.bioWrap);
  vaultBlob = made.blob;
  vaultKey = made.key;
  dataKeyRaw = made.raw;
  await Storage.setItem(VAULT_KEY, JSON.stringify(made.blob));
  bound.set(made.blob.v === 2);
  // Moved off the older phone-bound wrap: its key has nothing left to seal.
  if (before?.v === 2 && before.pinWrap && made.blob.v === 2 && made.blob.pinBox) await forgetKey(BOUND_ALIAS);
  await addQuickWrap();
}

/**
 * Set by "Lock now": the phone was just unlocked, so quick unlock would open the app again
 * at once. It waits until the user has left the app and come back.
 */
const quickHeldBack = signal(false);

/** Whether the lock screen may open a way in by itself (not straight after "Lock now"). */
export function autoUnlockAllowed(): boolean {
  return !quickHeldBack();
}

/**
 * The app lost the front (the screen turned off, the app switcher, another app): quick
 * unlock may be tried again when it returns. A signal, so the lock screen retries and its
 * hint updates.
 */
export function leftApp(): void {
  quickHeldBack.set(false);
}

/**
 * Closes the vault: every session leaves memory until the PIN is entered again.
 * `byUser`: "Lock now", which quick unlock mustn't undo straight away.
 */
export function lockNow(byUser = false): void {
  if (!hasPin()) return;
  if (byUser) quickHeldBack.set(true);
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
  forgetting = Promise.all([forgetKey(BOUND_ALIAS), forgetKey(PEPPER_ALIAS), forgetKey(QUICK_ALIAS), forgetKey(BIO_ALIAS)]);
  sessions.clear();
  clients.clear();
  touched();
  servers.set(servers().map((s) => ({ ...s, rememberMe: false })));
  // A new PIN starts from the safe default: quick unlock is asked for again, not inherited.
  quickUnlockOn.set(false);
  keyStoreRefused.set(false);
  await Storage.removeItem(VAULT_KEY);
  await Storage.removeItem(LOCKOUT_KEY);
  // The crash alerts' copies of the sessions go with them.
  await unwatchAll();
  await persistServers();
  await persistSecurity();
  hasPin.set(false);
  bound.set(false);
  biometricOn.set(false);
  biometricNotice.set(null);
  locked.set(false);
  pinSetupNeeded.set(false);
}

export function validatePin(pin: string): void {
  if (!/^\d{6,12}$/.test(pin)) throw new Error("Use 6 to 12 digits");
  // Repeated digits or blocks (111111, 121212, 123123), doubled runs (112233) and plain runs (123456, 987654).
  if (/^(\d{1,3})\1+$/.test(pin) || /^(\d)\1(\d)\2(\d)\3/.test(pin) || "01234567890123".includes(pin) || "98765432109876".includes(pin)) {
    throw new Error("That PIN is too easy to guess");
  }
}

/** The app's own settings, kept together so saving one never drops the other. */
async function persistSecurity(): Promise<void> {
  await Storage.setItem(SECURITY_KEY, JSON.stringify({ autoLockSeconds: autoLockSeconds(), quickUnlock: quickUnlockOn() }));
}

export async function setAutoLock(seconds: number): Promise<void> {
  seconds = Math.min(3600, Math.max(0, Math.floor(seconds)));
  autoLockSeconds.set(seconds);
  await persistSecurity();
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
      biometricOn.set(parsedVault.v === 2 && !!parsedVault.bioWrap);
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
    // Quick unlock is off unless the user turned it on (and only a plain `true` counts).
    quickUnlockOn.set(security?.quickUnlock === true);
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
    // "Hide personal details" is known before anything is shown.
    await loadPrivacy();
    await refreshCrashWatch();
    // Alerts kept for a server that's no longer in the list (removed while a switch was turning on).
    for (const id of crashWatch().watched) if (!servers().some((s) => s.id === id)) await unwatchServer(id);
    serversReady.set(true);
  }

  startRenewing();
  if (!locked()) {
    await persistSessions();
    renewSessions(true);
  }
}
