import { signal, Storage } from "nsh";
import { renew, logout as apiLogout } from "../api/auth";
import { AmpClient, AmpError } from "../api/client";
import type { AuthResponse } from "../api/types";

/**
 * A saved AMP server. Persisted with NSH `Storage`, which is a plain JSON file in the
 * app's private directory (not the OS keychain), so a server keeps at most its session
 * token ("Stay signed in"), never the password.
 */
export interface SavedServer {
  id: string;
  /** What the user calls it; defaults to the host name. */
  name: string;
  serverUrl: string;
  username: string;
  /** Index into `SERVER_COLORS`. */
  color: number;
  rememberMe: boolean;
  token?: string;
  /** ISO-8601 instant the token stops being accepted. */
  expiration?: string;
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

export const servers = signal<SavedServer[]>([]);
/** False until the saved servers have been read at launch. */
export const serversReady = signal(false);

/** Tokens of sessions the user did not ask to keep: in memory only, gone when the app closes. */
const memoryTokens = new Map<string, { token: string; expiration: string }>();
const clients = new Map<string, AmpClient>();

export function serverById(id: string): SavedServer | undefined {
  return servers().find((s) => s.id === id);
}

export function sessionOf(server: SavedServer): { token: string; expiration: string } | null {
  const session =
    server.token && server.expiration ? { token: server.token, expiration: server.expiration } : memoryTokens.get(server.id);
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
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

async function persist(): Promise<void> {
  const saved = servers().map((s) => (s.rememberMe ? s : { ...s, token: undefined, expiration: undefined }));
  await Storage.setItem(SERVERS_KEY, JSON.stringify(saved));
}

function update(id: string, change: (s: SavedServer) => SavedServer): void {
  servers.set(servers().map((s) => (s.id === id ? change(s) : s)));
}

function applySession(server: SavedServer, auth: AuthResponse, rememberMe: boolean): SavedServer {
  clients.delete(server.id);
  if (rememberMe) {
    memoryTokens.delete(server.id);
    return { ...server, rememberMe, token: auth.token, expiration: auth.expiration };
  }
  memoryTokens.set(server.id, { token: auth.token, expiration: auth.expiration });
  return { ...server, rememberMe, token: undefined, expiration: undefined };
}

/** Saves a newly signed-in server and returns its id. */
export async function addServer(input: {
  name: string;
  serverUrl: string;
  username: string;
  auth: AuthResponse;
  rememberMe: boolean;
}): Promise<string> {
  const id = newId();
  const base: SavedServer = {
    id,
    name: input.name.trim() || hostOf(input.serverUrl),
    serverUrl: input.serverUrl,
    username: input.username,
    color: servers().length % SERVER_COLORS.length,
    rememberMe: input.rememberMe,
  };
  servers.set([...servers(), applySession(base, input.auth, input.rememberMe)]);
  await persist();
  return id;
}

/** Stores a fresh sign-in for a saved server. */
export async function setServerSession(
  id: string,
  username: string,
  auth: AuthResponse,
  rememberMe: boolean,
): Promise<void> {
  update(id, (s) => applySession({ ...s, username }, auth, rememberMe));
  await persist();
}

/** Forgets a server's session locally; called when a request comes back 401. */
export async function clearServerSession(id: string): Promise<void> {
  memoryTokens.delete(id);
  clients.delete(id);
  update(id, (s) => ({ ...s, token: undefined, expiration: undefined }));
  await persist();
}

/** Signs out on the server (best effort) and forgets the session. */
export async function signOutServer(id: string): Promise<void> {
  try {
    await apiLogout(clientFor(id));
  } catch {
    // Offline or already expired: the local session goes either way.
  }
  await clearServerSession(id);
}

export async function removeServer(id: string): Promise<void> {
  const server = serverById(id);
  if (server && isSignedIn(server)) await signOutServer(id);
  memoryTokens.delete(id);
  clients.delete(id);
  servers.set(servers().filter((s) => s.id !== id));
  await persist();
}

/**
 * Launch: read the saved servers, then renew each remembered session in the background
 * so a token that is still valid gets a fresh expiry. A 401 forgets the session.
 */
export async function loadServers(): Promise<void> {
  try {
    const raw = await Storage.getItem(SERVERS_KEY);
    const saved = raw ? (JSON.parse(raw) as SavedServer[]) : [];
    servers.set(Array.isArray(saved) ? saved : []);
  } catch {
    servers.set([]);
  } finally {
    serversReady.set(true);
  }

  for (const server of servers()) {
    if (!isSignedIn(server)) continue;
    renew(clientFor(server.id))
      .then((fresh) => setServerSession(server.id, server.username, fresh, server.rememberMe))
      .catch((error) => {
        if (error instanceof AmpError && error.isUnauthorized) clearServerSession(server.id);
      });
  }
}
