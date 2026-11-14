import type { AmpClient } from "./client";
import type { SettingSpec } from "./manage";

/**
 * The installation's own settings and housekeeping: the platform settings manifest (the
 * same form the web panel draws), AMP updates, the licence, and the signed-in user's own
 * account (password and sessions).
 */

export interface PlatformSettingSpec extends SettingSpec {
  multipleOf?: number | string | null;
}

export interface SettingsManifest {
  /** Labels, descriptions and enum labels are keys into the panel's wording file. */
  specs: PlatformSettingSpec[];
  /** Current values by node id, as strings. */
  values: Record<string, string>;
  /** For secrets: whether one is stored (it is never sent). */
  secretHasValue: Record<string, boolean>;
  actions: { id: string; category: string; subcategory: string }[];
  /** Nodes this machine can't take, with a wording key saying why. */
  unavailable?: Record<string, string> | null;
}

export const getSettingsManifest = (c: AmpClient) => c.request<SettingsManifest>("/api/settings/manifest");

/** `POST /api/settings/values`: saves changed nodes; returns notices about follow-ups that couldn't be done. */
export async function saveSettings(c: AmpClient, values: Record<string, string>): Promise<{ code?: string; message?: string }[]> {
  const result = await c.request<{ notices?: { code?: string; message?: string }[] } | undefined>("/api/settings/values", {
    method: "POST",
    body: values,
  });
  return result?.notices ?? [];
}

/** Runs an inline action (`smtp.test`, `templates.sync`, ...) and returns what it said. */
export function runSettingsAction(c: AmpClient, id: string): Promise<unknown> {
  return c.request(`/api/settings/actions/${encodeURIComponent(id)}`, { method: "POST", timeoutMs: 60_000 });
}

export interface UpdateStatus {
  currentVersion: string;
  stream: string;
  availableStreams: string[];
  latestVersion: string;
  updateAvailable: boolean;
  mandatory: boolean;
  codename: string;
  releaseNotesUrl: string;
  supervised: boolean;
  canApply: boolean;
  note: string | null;
  spiresBehind: { spireId: string; name: string; version: string | null; online: boolean }[];
  packageManaged: boolean;
  rolledBack?: { version: string; kind: string; atUtc: string; reason: string } | null;
}

/** `GET /api/Updates/check`: fetches the signed release list, so it can take a while. */
export const checkForUpdates = (c: AmpClient) => c.request<UpdateStatus>("/api/Updates/check", { timeoutMs: 45_000 });

/** `POST /api/Updates/apply`: stages the newest version everywhere and restarts AMP onto it. */
export const applyUpdate = (c: AmpClient) => c.request<unknown>("/api/Updates/apply", { method: "POST", timeoutMs: 60_000 });

export interface Licence {
  spireName: string;
  productName: string;
  gradeName: string;
  state: string;
  standing: string;
  expires: string | null;
  graceEnds: string | null;
  shardLimit: number | null;
}

export interface LicenceStatus {
  licences: Licence[];
  shardCount: number;
  otherInstallationShards: number;
  licensed: boolean;
  confirmed: boolean;
  shardLimit: number | null;
  lastVerifiedAt: string | null;
}

export const getLicence = (c: AmpClient) => c.request<LicenceStatus>("/api/licence");

export interface Profile {
  id: string;
  userName: string | null;
  displayName: string | null;
  email: string | null;
}

export interface Session {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  remoteIp: string;
  userAgent: string;
  isCurrent: boolean;
}

export const getProfile = (c: AmpClient) => c.request<Profile>("/api/Profile");
export const listSessions = (c: AmpClient) => c.request<Session[]>("/api/Profile/sessions");

/** Checks the current password, sets the new one and ends every other session. */
export async function changePassword(c: AmpClient, currentPassword: string, newPassword: string): Promise<void> {
  await c.request("/api/Profile/password", { method: "POST", body: { currentPassword, newPassword } });
}

export async function revokeSession(c: AmpClient, id: string): Promise<void> {
  await c.request(`/api/Profile/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function revokeOtherSessions(c: AmpClient): Promise<void> {
  await c.request("/api/Profile/sessions/others", { method: "DELETE" });
}

/** A wording key as people read it when the panel's file lacks it: `settings.smtp.fromAddress` → "From address". */
export function keyLabel(key: string): string {
  const last = key.split(".").filter(Boolean).pop() ?? key;
  const words = last.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1).toLowerCase() : key;
}

/** A user agent as a short device name: "Chrome on Windows", "AMP Mobile", ... */
export function deviceName(ua: string): string {
  if (!ua) return "Unknown device";
  // Apps (this one included) send their HTTP library's name rather than a browser's.
  if (/okhttp|Dalvik/i.test(ua)) return "Android app";
  if (/CFNetwork|Darwin/i.test(ua)) return "iOS app";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null;
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad|iOS/.test(ua)
        ? "iOS"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? ua.slice(0, 40);
}
