import type { AmpClient } from "./client";

/**
 * An instance's snapshots (AMP 3's backups): a timeline of captures, each either full or a
 * partial (only what changed since its parent), holding any mix of the game's data, the
 * base install and AMP's own settings. Taking and restoring run in the background on the
 * instance's machine, so a screen polls the timeline to follow them.
 *
 * The numeric codes aren't named in the API's spec; these are the web panel's own.
 * Capabilities: snapshots.read, .create (also renaming, pinning, limits), .restore, .delete.
 */

export const Kind = { Full: 0, Partial: 1 } as const;
export const Content = { GameState: 1, BaseData: 2, AmpConfig: 4 } as const;
export const Status = { Pending: 0, Running: 1, Complete: 2, Failed: 3 } as const;
export const Stage = { None: 0, Gathering: 1, Processing: 2, Finalizing: 3 } as const;

const TRIGGERS = ["Taken by hand", "Scheduled", "Before an update", "Before a restore"];
const STAGES = ["Starting", "Gathering files", "Processing", "Finishing"];

/** The panel's name limit; the description's is the panel's to enforce, this only keeps it reasonable. */
export const NAME_MAX = 64;
export const DESCRIPTION_MAX = 500;

export interface Snapshot {
  id: string;
  parentId: string | null;
  kind: number;
  content: number;
  trigger: number;
  status: number;
  name: string | null;
  description: string | null;
  sticky: boolean;
  failureReason: string | null;
  skippedFiles: { relPath: string; reason: string }[];
  skippedCount: number;
  archiveMissing: boolean;
  createdAt: string;
  sizeMb: number;
  uncompressedMb: number;
  fileCount: number;
  stage: number;
  processedFiles: number;
  totalFiles: number;
}

export interface SnapshotSettings {
  /** The most one snapshot may hold, uncompressed, in MB. 0: no limit. */
  maxBackupSizeMb: number;
  /** The most all of this instance's snapshots may take, in MB. 0: no limit. */
  maxTotalStorageMb: number;
  /** Stop the game while capturing when it has no way to pause its saving. */
  stopWhenNoQuiesce: boolean;
}

export interface SnapshotTimeline {
  nodes: Snapshot[];
  /** The snapshot whose files are on disk now. */
  headId: string | null;
  settings: SnapshotSettings | null;
  /** A restore in progress. */
  restoringId: string | null;
  restoreStage: number;
  restoreProcessed: number;
  restoreTotal: number;
}

const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

// Answers are tidied once here, so a field a panel leaves out never breaks the screen.
function tidySnapshot(raw: unknown): Snapshot | null {
  const s = (raw ?? {}) as Record<string, unknown>;
  if (typeof s.id !== "string") return null;
  return {
    id: s.id,
    parentId: str(s.parentId),
    kind: num(s.kind),
    content: num(s.content),
    trigger: num(s.trigger),
    status: num(s.status),
    name: str(s.name),
    description: str(s.description),
    sticky: s.sticky === true,
    failureReason: str(s.failureReason),
    skippedFiles: Array.isArray(s.skippedFiles)
      ? s.skippedFiles
          .filter((f): f is { relPath: string; reason?: unknown } => typeof f?.relPath === "string")
          .map((f) => ({ relPath: f.relPath, reason: typeof f.reason === "string" ? f.reason : "" }))
      : [],
    skippedCount: num(s.skippedCount),
    archiveMissing: s.archiveMissing === true,
    createdAt: typeof s.createdAt === "string" ? s.createdAt : "",
    sizeMb: num(s.sizeMb),
    uncompressedMb: num(s.uncompressedMb),
    fileCount: num(s.fileCount),
    stage: num(s.stage),
    processedFiles: num(s.processedFiles),
    totalFiles: num(s.totalFiles),
  };
}

function tidySettings(raw: unknown): SnapshotSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  return { maxBackupSizeMb: num(s.maxBackupSizeMb), maxTotalStorageMb: num(s.maxTotalStorageMb), stopWhenNoQuiesce: s.stopWhenNoQuiesce === true };
}

const base = (shardId: string) => `/api/shards/${encodeURIComponent(shardId)}/snapshots`;

/** The timeline, newest first. */
export async function getTimeline(c: AmpClient, shardId: string): Promise<SnapshotTimeline> {
  const g = ((await c.request<unknown>(base(shardId))) ?? {}) as Record<string, unknown>;
  const nodes = (Array.isArray(g.nodes) ? g.nodes : [])
    .map(tidySnapshot)
    .filter((n): n is Snapshot => !!n)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return {
    nodes,
    headId: str(g.headId),
    settings: tidySettings(g.settings),
    restoringId: str(g.restoringId),
    restoreStage: num(g.restoreStage),
    restoreProcessed: num(g.restoreProcessed),
    restoreTotal: num(g.restoreTotal),
  };
}

export interface NewSnapshot {
  kind: number;
  content: number;
  name?: string;
  description?: string;
  sticky?: boolean;
}

/** Starts a capture; it carries on in the background. */
export async function takeSnapshot(c: AmpClient, shardId: string, s: NewSnapshot): Promise<Snapshot | null> {
  const made = await c.request<unknown>(base(shardId), {
    method: "POST",
    body: { kind: s.kind, content: s.content, name: s.name?.trim() || null, description: s.description?.trim() || null, sticky: !!s.sticky },
  });
  return tidySnapshot(made);
}

/** Rewinds the instance to a snapshot. AMP first snapshots what's there now, so it can be undone. */
export async function restoreSnapshot(c: AmpClient, shardId: string, id: string): Promise<void> {
  await c.request(`${base(shardId)}/${encodeURIComponent(id)}/restore`, { method: "POST", body: {} });
}

export async function deleteSnapshot(c: AmpClient, shardId: string, id: string): Promise<void> {
  await c.request(`${base(shardId)}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Renames, re-describes or pins a snapshot (pinned ones are never pruned automatically). */
export async function editSnapshot(
  c: AmpClient,
  shardId: string,
  id: string,
  meta: { name: string | null; description: string | null; sticky: boolean },
): Promise<void> {
  await c.request(`${base(shardId)}/${encodeURIComponent(id)}/meta`, {
    method: "PUT",
    body: { name: meta.name?.trim() || null, description: meta.description?.trim() || null, sticky: meta.sticky },
  });
}

export async function getSnapshotSettings(c: AmpClient, shardId: string): Promise<SnapshotSettings> {
  return tidySettings(await c.request<unknown>(`${base(shardId)}/settings`)) ?? { maxBackupSizeMb: 0, maxTotalStorageMb: 0, stopWhenNoQuiesce: false };
}

export async function saveSnapshotSettings(c: AmpClient, shardId: string, s: SnapshotSettings): Promise<SnapshotSettings> {
  return tidySettings(await c.request<unknown>(`${base(shardId)}/settings`, { method: "PUT", body: s })) ?? s;
}

// Words for the screen.

export const isBusy = (s: Snapshot) => s.status === Status.Pending || s.status === Status.Running;

export function triggerLabel(s: Snapshot): string {
  return TRIGGERS[s.trigger] ?? "Other";
}

export function stageLabel(stage: number): string {
  return STAGES[stage] ?? "Working";
}

/** "Game data, AMP settings". */
export function contentLabel(content: number): string {
  const parts: string[] = [];
  if (content & Content.GameState) parts.push("Game data");
  if (content & Content.BaseData) parts.push("Base install");
  if (content & Content.AmpConfig) parts.push("AMP settings");
  return parts.join(", ") || "Nothing";
}

/** Progress as a whole percentage, or null while the total isn't known yet. */
export function percent(done: number, total: number): number | null {
  return total > 0 ? Math.min(100, Math.max(0, Math.round((done / total) * 100))) : null;
}

/** "850 MB", "1.4 GB". */
export function megabytes(mb: number): string {
  if (mb >= 1024 * 1024) return `${(mb / 1024 / 1024).toFixed(1)} TB`;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.max(0, Math.round(mb))} MB`;
}
