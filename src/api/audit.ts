import type { AmpClient } from "./client";

/**
 * AMP 3's audit log (`/api/Audit*`): who did what, and when. Reading it needs the
 * `platform.audit.read` capability. Events group into flows: a click, a scheduled run or a
 * system tick (the root), then everything it set off, linked by a correlation id.
 */

/** As the panel numbers them. Query parameters take the names. */
export const AuditSeverity = { Info: 0, Warning: 1, Security: 2 } as const;
export const AuditOrigin = { System: 0, User: 1, UserFlow: 2, Scheduled: 3, Impersonation: 4 } as const;

export interface TaskPrincipal {
  kind: number;
  userId: string | null;
  userDisplayName: string | null;
  onBehalfOfUserId: string | null;
  onBehalfOfUserDisplayName: string | null;
  /** For the system and schedules: e.g. "Daily Backup". */
  systemSource: string | null;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  severity: number;
  principal: TaskPrincipal | null;
  /** PascalCase, e.g. `ShardSettingChanged`. */
  action: string;
  targetType: string;
  targetId: string;
  taskId: string | null;
  correlationId: { value: string } | string | null;
  origin: number;
  rootPrincipal?: TaskPrincipal | null;
  /** Free-form JSON, for people to read. */
  details: string | null;
  originIp: string | null;
  originNode: string | null;
}

export interface AuditRootItem {
  correlationId: string;
  root: AuditEvent;
  eventCount: number;
  startedAt: string;
  endedAt: string;
  maxSeverity: number;
  rootMissing: boolean;
}

export interface AuditRootsResult {
  total: number;
  page: number;
  pageSize: number;
  caughtUp: boolean;
  items: AuditRootItem[];
}

export interface AuditTreeNode {
  event: AuditEvent;
  children: AuditTreeNode[];
}

export interface AuditTree {
  correlationId: string;
  rootMissing: boolean;
  eventCount: number;
  startedAt: string;
  endedAt: string;
  root: AuditTreeNode;
}

export interface AuditQuery {
  search?: string;
  minSeverity?: "Warning" | "Security";
  origin?: "User" | "System" | "Scheduled" | "Impersonation";
  targetId?: string;
  page?: number;
  pageSize?: number;
}

/** `GET /api/Audit/roots`: one row per flow, newest first. */
export function listAuditFlows(client: AmpClient, q: AuditQuery = {}): Promise<AuditRootsResult> {
  return client.request<AuditRootsResult>("/api/Audit/roots", {
    query: {
      search: q.search || undefined,
      minSeverity: q.minSeverity,
      origin: q.origin,
      targetId: q.targetId,
      page: q.page ?? 1,
      pageSize: q.pageSize ?? 30,
    },
  });
}

/** `GET /api/Audit/tree/{correlationId}`: a flow with everything it caused, nested. */
export function getAuditTree(client: AmpClient, correlationId: string): Promise<AuditTree> {
  return client.request<AuditTree>(`/api/Audit/tree/${encodeURIComponent(correlationId)}`);
}

/**
 * An action as people read it: the panel's own wording when its text table has it
 * ("Removed a server's old message bus credential after its renewal"), otherwise the
 * name split into words ("ShardSettingChanged" → "Shard setting changed").
 */
export function actionLabel(action: string, text: Record<string, string> = {}): string {
  const panel = text[`audit.action.${action}`];
  if (panel) return panel;
  return splitWords(action);
}

/** How the panel colours an action: red for failures and removals, amber for changes, green for new things. */
export function actionKind(action: string): "info" | "danger" | "warn" | "ok" {
  if (action === "ShardBusRetiredKeyRevoked") return "info";
  if (/Failed|Killed|Deleted|Revoked/i.test(action)) return "danger";
  if (/Changed|Updated|Upserted|Restored/i.test(action)) return "warn";
  if (/Created|LoggedIn|Synced/i.test(action)) return "ok";
  return "info";
}

function splitWords(action: string): string {
  const words = action
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(" ")
    .filter(Boolean);
  return words.map((w, i) => (i === 0 || /^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase())).join(" ");
}

/** Who an event names: the person, "Schedule: Daily Backup", or "System". */
/** `name` dresses a person's name (the app's "Hide personal details"); schedules and the system stay readable. */
export function actorOf(event: AuditEvent, name: (n: string) => string = (n) => n): string {
  const p = event.principal;
  const person = p?.userDisplayName || p?.onBehalfOfUserDisplayName;
  if (event.origin === AuditOrigin.Impersonation && p?.userDisplayName && p.onBehalfOfUserDisplayName) {
    return `${name(p.userDisplayName)} as ${name(p.onBehalfOfUserDisplayName)}`;
  }
  if (event.origin === AuditOrigin.Scheduled) return p?.systemSource ? `Schedule: ${p.systemSource}` : person ? `Schedule (${name(person)})` : "Schedule";
  if (person) return name(person);
  return p?.systemSource || "System";
}

/** `details` pretty-printed when it's JSON, as it came otherwise; null when empty. */
export function prettyDetails(details: string | null): string | null {
  if (!details || details === "{}" || details === "null") return null;
  try {
    return JSON.stringify(JSON.parse(details), null, 2);
  } catch {
    return details;
  }
}
