import { host, signal } from "nsh";

/**
 * Crash alerts: a notification when an instance stops, fails or restarts with no one behind
 * it, checked about every 15 minutes while the app is closed. The checking is done by the
 * Android app around the TSX app (android/, CrashWatch.java), which keeps each watched
 * server's session sealed by a phone key of its own, outside the PIN vault, as it has to run
 * without the user. This module turns it on and off and hands it every fresh token; signing
 * out, turning "stay signed in" off and erasing the saved sign-ins take the token back.
 *
 * Elsewhere (tests without a host, desktops) it is unavailable and every call does nothing.
 */

export type AlertPermission = "granted" | "denied" | "default";

export interface CrashWatchState {
  /** The phone can run crash alerts. */
  available: boolean;
  permission: AlertPermission;
  /** Servers with crash alerts on. */
  watched: string[];
  /** Of those, the ones AMP signed out: alerts wait for the next sign-in. */
  paused: string[];
}

export const crashWatch = signal<CrashWatchState>({ available: false, permission: "default", watched: [], paused: [] });

/** A pressed alert, waiting for the app to be unlocked to open it. */
export const alertOpened = signal<{ serverId: string; shardId: string | null; title: string | null } | null>(null);

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

async function call(name: string, data: unknown = null, timeout = 30_000): Promise<unknown> {
  if (!host.available()) throw new Error("unavailable: no host");
  return host.call(`crashWatch.${name}`, data, { timeout });
}

/** Reads what the phone has. Never throws: an error reads as unavailable. */
export async function refreshCrashWatch(): Promise<void> {
  try {
    // Launch waits for this, so a host that doesn't answer mustn't hold it up long.
    const s = ((await call("status", null, 5000)) ?? {}) as Record<string, unknown>;
    const p = s.permission;
    crashWatch.set({
      available: true,
      permission: p === "granted" || p === "denied" ? p : "default",
      watched: strings(s.watched),
      paused: strings(s.paused),
    });
  } catch {
    crashWatch.set({ available: false, permission: "default", watched: [], paused: [] });
  }
}

/** Shows the phone's notification prompt the first time; after that, answers what the settings hold. */
export async function requestAlertPermission(): Promise<AlertPermission> {
  try {
    // The prompt waits on the user.
    const p = await call("requestPermission", null, 300_000);
    const permission: AlertPermission = p === "granted" || p === "denied" ? p : "default";
    crashWatch.set({ ...crashWatch(), permission });
    return permission;
  } catch {
    return crashWatch().permission;
  }
}

/** The phone's notification settings for the app, where a refused permission can be given. */
export async function openAlertSettings(): Promise<void> {
  try {
    await call("openSettings");
  } catch {
    // Nothing to open.
  }
}

/** Turns crash alerts on for a signed-in server. Throws when the phone refuses. */
export async function watchServer(server: { id: string; serverUrl: string; name: string }, session: { token: string; expiration: string }): Promise<void> {
  await call("set", { serverId: server.id, url: server.serverUrl, name: server.name, token: session.token, expiration: session.expiration });
  await refreshCrashWatch();
}

/** A fresh token for a server with alerts on (a sign-in, a renewal, an unlock). */
export async function handOverToken(serverId: string, session: { token: string; expiration: string }): Promise<void> {
  if (!crashWatch().watched.includes(serverId)) return;
  try {
    await call("token", { serverId, token: session.token, expiration: session.expiration });
    if (crashWatch().paused.includes(serverId)) await refreshCrashWatch();
  } catch {
    // The next sign-in or renewal hands it over again.
  }
}

/** Turns crash alerts off for a server, and forgets its token. */
export async function unwatchServer(serverId: string): Promise<void> {
  if (!crashWatch().watched.includes(serverId)) return;
  try {
    await call("remove", { serverId });
  } catch {
    // Unavailable: there's nothing kept to forget.
  }
  await refreshCrashWatch();
}

/** Crash alerts off for every server, their tokens and key gone (the saved sign-ins were erased). */
export async function unwatchAll(): Promise<void> {
  if (!crashWatch().available) return;
  try {
    await call("clear");
  } catch {
    // Unavailable: there's nothing kept to forget.
  }
  await refreshCrashWatch();
}

/** Listens for pressed alerts, from launch: a press that started the app waits for this. */
export function listenForAlertPresses(): void {
  if (!host.available()) return;
  host.on("crashWatch.open", (payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    if (typeof p.serverId !== "string" || !p.serverId) return;
    const text = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 200) : null);
    alertOpened.set({ serverId: p.serverId, shardId: text(p.shardId), title: text(p.title) });
  });
}
