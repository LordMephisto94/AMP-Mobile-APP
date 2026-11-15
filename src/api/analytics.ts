import { type AmpClient, readCapped } from "./client";

/**
 * AMP 3's player analytics (`/api/Analytics/*`): who played, when, for how long and from
 * where. Summaries need `analytics.read` on a server; names and per-player detail need
 * `analytics.users`. Without an analytics licence AMP answers with invented numbers and
 * `isDemo: true`, which the app must say plainly.
 *
 * Decimal figures may arrive as numbers or as strings; read them with `num`.
 */

export type Decimal = number | string | null | undefined;

/** A figure that may come as a number, a numeric string, or nothing. */
export function num(value: Decimal): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export interface SessionTotals {
  sessions: number;
  uniqueUsers: number;
  newUsers: number;
  minutes: Decimal;
  bounceRatePercent: Decimal;
  averageSessionMinutes: Decimal;
  sessionsPerUser: Decimal;
  longestSessionMinutes: Decimal;
  activeUsers: number;
  activeRatePercent: Decimal;
}

export interface SessionBucket {
  start: string;
  end: string;
  users: number;
}

export interface CountryUsage {
  country: string;
  sessions: number;
  sessionsPercent: Decimal;
  minutes: Decimal;
  minutesPercent: Decimal;
  users: number | null;
}

export interface TopUser {
  userKey: string;
  displayName: string | null;
  sessions: number;
  minutes: Decimal;
  percent: Decimal;
  servers: number;
  online: boolean;
}

export interface ServerUsage {
  shardId: string;
  sessions: number;
  sessionsPercent: Decimal;
  minutes: Decimal;
  minutesPercent: Decimal;
  users: number;
}

export interface GameUsage {
  game: string;
  sessions: number;
  sessionsPercent: Decimal;
  minutes: Decimal;
  minutesPercent: Decimal;
  users: number;
  servers: number;
}

export interface AnalyticsServer {
  name: string;
  game: string;
  gameName: string;
  image: string | null;
}

export interface ActivityRule {
  visits: number | string;
  days: number | string;
}

export interface SessionSummary {
  window: { from: string; to: string };
  current: SessionTotals;
  previous: SessionTotals;
  /** % change per figure (keyed like `SessionTotals`), null where there was nothing before. */
  change: Record<string, Decimal>;
  activity: SessionBucket[];
  countries: CountryUsage[];
  topUsers: TopUser[];
  busiest: SessionBucket | null;
  quietest: SessionBucket | null;
  servers: ServerUsage[];
  games: GameUsage[];
  isDemo?: boolean;
  serverInfo?: Record<string, AnalyticsServer> | null;
  rule?: ActivityRule | null;
}

export interface SessionView {
  sessionRef: string;
  shardId: string;
  userKey: string;
  idKind: string;
  country: string;
  startedAt: string;
  endedAt: string;
  running: boolean;
  displayName: string | null;
}

export interface UserDetail {
  userKey: string;
  displayName: string | null;
  totals: SessionTotals;
  servers: ServerUsage[];
  sessions: SessionView[];
  firstSeen: string | null;
  lastSeen: string | null;
  isActive: boolean;
  recentVisits: number;
  rule: ActivityRule;
  serverInfo: Record<string, AnalyticsServer>;
  isDemo?: boolean;
}

export interface UserMatch {
  userKey: string;
  displayName: string | null;
  userId: string | null;
  idKind: string;
  shards: string[];
  lastSeen: string;
}

export interface UserSearch {
  users: UserMatch[];
  serverInfo: Record<string, AnalyticsServer>;
  isDemo?: boolean;
}

export interface SteamProfile {
  steamId: string;
  personaName: string | null;
  avatarHash: string | null;
  visibility: "Unknown" | "Private" | "FriendsOnly" | "Public";
  createdAt: string | null;
  countryCode: string | null;
  bans: {
    vacBanned: boolean;
    vacBans: number | null;
    gameBans: number | null;
    daysSinceLastBan: number | null;
    communityBanned: boolean | null;
    tradeBanned: boolean | null;
  } | null;
  limited: boolean | null;
  profileUrl?: string | null;
}

export interface MinecraftProfile {
  uuid: string;
  name: string;
  skinHash: string | null;
  slim: boolean;
  hasCape: boolean;
}

export interface ProfilesAnswer {
  steam: Record<string, SteamProfile>;
  minecraft: Record<string, MinecraftProfile>;
  /** complete, pending, keyRejected, unreachable, off or notLicensed. */
  state: string;
  isDemo?: boolean;
}

export interface Period {
  from: Date;
  to: Date;
  /** Only these servers; all the caller may read when left out. */
  shards?: string[];
}

/** `GET /api/Analytics/sessions`: a period's figures against the period before it. */
export function getSessionSummary(client: AmpClient, period: Period, topUsers = 10): Promise<SessionSummary> {
  return client.request<SessionSummary>("/api/Analytics/sessions", {
    query: { from: period.from.toISOString(), to: period.to.toISOString(), shard: period.shards, topUsers },
  });
}

/** `GET /api/Analytics/sessions/users/{key}`: one player's sessions in the period. */
export function getUserDetail(client: AmpClient, userKey: string, period: Period): Promise<UserDetail> {
  return client.request<UserDetail>(`/api/Analytics/sessions/users/${encodeURIComponent(userKey)}`, {
    query: { from: period.from.toISOString(), to: period.to.toISOString(), shard: period.shards },
  });
}

/** `GET /api/Analytics/users?q=`: players by name, id or short code (two characters at least). */
export function searchUsers(client: AmpClient, q: string, limit = 20): Promise<UserSearch> {
  return client.request<UserSearch>("/api/Analytics/users", { query: { q, limit } });
}

/** `GET /api/Analytics/profiles?key=`: Steam and Minecraft profiles, up to a hundred keys. */
export function getProfiles(client: AmpClient, keys: string[]): Promise<ProfilesAnswer> {
  return client.request<ProfilesAnswer>("/api/Analytics/profiles", { query: { key: keys.slice(0, 100) } });
}

/**
 * A Steam avatar fetched through the panel (`GET /api/Analytics/avatars/{hash}`), which
 * keeps the device's address away from Steam. The endpoint needs the session token, which
 * an `<Image>` can't send, so it comes back as a `blob:` URL; null when it can't be had.
 */
export async function avatarUrl(client: AmpClient, hash: string): Promise<string | null> {
  // A Steam avatar hash is hex; anything else isn't asked for.
  if (!/^[0-9a-f]{20,64}$/i.test(hash)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${client.baseUrl}/api/Analytics/avatars/${encodeURIComponent(hash)}?full=true`, {
      headers: client.token ? { Authorization: `Bearer ${client.token}` } : {},
      // Never let the token follow a redirect elsewhere.
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    // Only a plain raster picture (not SVG, which can carry markup and links), and only a small one.
    const type = (response.headers.get("content-type") ?? "").toLowerCase().split(";")[0].trim();
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(type)) return null;
    // Counted as it arrives: a body with no declared length can't be buffered past the cap.
    const bytes = await readCapped(response, MAX_AVATAR_BYTES);
    return URL.createObjectURL(new Blob([bytes], { type }));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/** A country's ISO 3166-1 alpha-2 code, upper case ("gb" → "GB"); null when it isn't one. */
export function countryCode(country: string | null | undefined): string | null {
  const code = (country ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

/** Minutes as a short duration: "45m", "3h 20m", "2d 4h". */
export function duration(minutes: Decimal): string {
  const m = Math.round(num(minutes));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}
