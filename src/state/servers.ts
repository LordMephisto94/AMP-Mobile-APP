import { signal, Storage } from "nsh";
import { renew, logout as apiLogout } from "../api/auth";
import { AmpClient, AmpError } from "../api/client";
import type { AuthResponse } from "../api/types";
import { createVault, isVaultBlob, keyFor, seal, unseal, type VaultBlob, type VaultKey } from "./vaultCrypto";

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
let vaultKey: VaultKey | null = null;

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
  if (locked()) return;
  const remembered = rememberedSessions();
  if (vaultKey && vaultBlob) {
    vaultBlob = { ...vaultBlob, data: await seal(vaultKey, remembered) };
    await Storage.setItem(VAULT_KEY, JSON.stringify(vaultBlob));
    return;
  }
  pinSetupNeeded.set(Object.keys(remembered).length > 0);
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
  await signOutServer(id);
  servers.set(servers().filter((s) => s.id !== id));
  await persistServers();
  await persistSessions();
}

// ---- Renewal -------------------------------------------------------------------------------

/**
 * Renews one session. It's tried even past the token's advertised expiry, since AMP
 * renews the session rather than the token. The answer is applied only if this is still
 * the session it renewed (no sign-out, sign-in or other renewal since, and not locked).
 */
async function renewSession(id: string): Promise<void> {
  const server = serverById(id);
  const session = sessions.get(id);
  if (!server || !session) return;
  const gen = session.gen;
  const stillCurrent = () => !locked() && sessions.get(id)?.gen === gen;
  try {
    const fresh = await renew(new AmpClient(server.serverUrl, session.token));
    if (!stillCurrent()) return;
    applySession(id, fresh);
    await persistSessions();
  } catch (error) {
    if (error instanceof AmpError && error.isUnauthorized && stillCurrent()) await clearServerSession(id);
  }
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
    return v && typeof v.failures === "number" ? v : { failures: 0, until: 0 };
  } catch {
    return { failures: 0, until: 0 };
  }
}

/** Sets the first PIN and seals the sessions waiting to be kept. */
export async function setupPin(pin: string): Promise<void> {
  validatePin(pin);
  const { blob, key } = await createVault(pin, rememberedSessions());
  vaultBlob = blob;
  vaultKey = key;
  await Storage.setItem(VAULT_KEY, JSON.stringify(blob));
  await Storage.removeItem(LOCKOUT_KEY);
  hasPin.set(true);
  pinSetupNeeded.set(false);
}

/** Keeps this session's sign-ins in memory only: they're not saved, and nobody asks again for them. */
export async function declinePin(): Promise<void> {
  servers.set(servers().map((s) => (s.rememberMe && !hasPin() ? { ...s, rememberMe: false } : s)));
  pinSetupNeeded.set(false);
  await persistServers();
}

export type UnlockResult = { ok: true } | { ok: false; wrong: boolean; triesLeft: number; waitSeconds: number; erased: boolean };

/** Seconds until another PIN may be tried (0: now). */
export async function lockoutRemaining(): Promise<number> {
  const l = await readLockout();
  return Math.max(0, Math.ceil((l.until - Date.now()) / 1000));
}

/**
 * Opens the vault. Wrong PINs are counted on disk (so restarting doesn't reset them):
 * after five, each try waits longer; the tenth erases the saved sign-ins.
 */
export async function unlock(pin: string): Promise<UnlockResult> {
  if (!vaultBlob) return { ok: true };
  const lockout = await readLockout();
  if (lockout.until > Date.now()) {
    return { ok: false, wrong: false, triesLeft: MAX_PIN_TRIES - lockout.failures, waitSeconds: Math.ceil((lockout.until - Date.now()) / 1000), erased: false };
  }
  const key = await keyFor(vaultBlob, pin);
  if (!key) {
    const failures = lockout.failures + 1;
    if (failures >= MAX_PIN_TRIES) {
      await eraseVault();
      return { ok: false, wrong: true, triesLeft: 0, waitSeconds: 0, erased: true };
    }
    const wait = failures >= FREE_TRIES ? LOCKOUT_WAITS_S[Math.min(failures - FREE_TRIES, LOCKOUT_WAITS_S.length - 1)] : 0;
    await Storage.setItem(LOCKOUT_KEY, JSON.stringify({ failures, until: Date.now() + wait * 1000 }));
    return { ok: false, wrong: true, triesLeft: MAX_PIN_TRIES - failures, waitSeconds: wait, erased: false };
  }
  let saved: Record<string, { token: string; expiration: string }> = {};
  try {
    saved = await unseal(key, vaultBlob.data);
  } catch {
    // The sessions can't be read (altered on disk): start them afresh behind the same PIN.
    saved = {};
  }
  vaultKey = key;
  await Storage.removeItem(LOCKOUT_KEY);
  for (const [id, s] of Object.entries(saved)) {
    if (serverById(id) && typeof s?.token === "string" && typeof s?.expiration === "string") applySession(id, s);
  }
  locked.set(false);
  await persistSessions();
  renewSessions(true);
  return { ok: true };
}

/** Closes the vault: every session leaves memory until the PIN is entered again. */
export function lockNow(): void {
  if (!hasPin()) return;
  generation++;
  vaultKey = null;
  sessions.clear();
  clients.clear();
  touched();
  locked.set(true);
}

/** Changes the PIN; the sessions are resealed under the new one. */
export async function changePin(oldPin: string, newPin: string): Promise<boolean> {
  if (!vaultBlob) return false;
  validatePin(newPin);
  const key = await keyFor(vaultBlob, oldPin);
  if (!key) return false;
  const { blob, key: fresh } = await createVault(newPin, rememberedSessions());
  vaultBlob = blob;
  vaultKey = fresh;
  await Storage.setItem(VAULT_KEY, JSON.stringify(blob));
  return true;
}

/**
 * Forgets the PIN and every saved sign-in (the "Forgot PIN" way out, and what ten wrong
 * PINs do). Servers stay in the list, signed out.
 */
export async function eraseVault(): Promise<void> {
  generation++;
  vaultBlob = null;
  vaultKey = null;
  sessions.clear();
  clients.clear();
  touched();
  servers.set(servers().map((s) => ({ ...s, rememberMe: false })));
  await Storage.removeItem(VAULT_KEY);
  await Storage.removeItem(LOCKOUT_KEY);
  await persistServers();
  hasPin.set(false);
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
  let migrated = false;
  try {
    const rawVault = await Storage.getItem(VAULT_KEY);
    const parsedVault = rawVault ? JSON.parse(rawVault) : null;
    if (isVaultBlob(parsedVault)) {
      vaultBlob = parsedVault;
      hasPin.set(true);
      locked.set(true);
    }

    const rawSecurity = await Storage.getItem(SECURITY_KEY);
    const security = rawSecurity ? JSON.parse(rawSecurity) : null;
    if (typeof security?.autoLockSeconds === "number") autoLockSeconds.set(security.autoLockSeconds);

    const raw = await Storage.getItem(SERVERS_KEY);
    const saved = raw ? JSON.parse(raw) : [];
    const list: SavedServer[] = [];
    for (const s of Array.isArray(saved) ? saved : []) {
      if (!s || typeof s.id !== "string" || typeof s.serverUrl !== "string") continue;
      list.push({ id: s.id, name: String(s.name ?? ""), serverUrl: s.serverUrl, username: String(s.username ?? ""), color: Number(s.color) || 0, rememberMe: !!s.rememberMe });
      // An older version's plain-text token: into memory, never back to disk.
      if (typeof s.token === "string") {
        migrated = true;
        if (!vaultBlob && typeof s.expiration === "string") applySession(s.id, { token: s.token, expiration: s.expiration });
      }
    }
    servers.set(list);
    if (migrated) await persistServers();
  } catch {
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
