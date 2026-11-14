import type { AmpClient } from "./client";
import type { SpireDefinition } from "./manage";

/** Read-only views of a machine (spire): roster, boot order, ports and storage. */

export interface SpireRosterItem {
  spire: SpireDefinition;
  online: boolean;
  lastSeen: string | null;
  /** The AMP version it last reported. */
  version: string | null;
  /** Older than the installation: needs updating. */
  behind: boolean;
  installationVersion: string | null;
}

export interface SpireStartupEntry {
  shardId: string;
  shardName: string;
  startOnBoot: boolean;
  order: number;
}

export interface SpirePortEntry {
  port: number;
  protocol: string;
  ref: string;
  name: string;
  shardId: string;
  shardName: string;
  ipBinding: string;
  running: boolean;
  listening: boolean;
  conflict: boolean;
}

export interface SpireDatastore {
  id: string;
  name: string;
  path: string;
  isDefault: boolean;
  enabled: boolean;
  softLimitMb?: number | string;
  tags?: string[];
}

export interface ShardDiskUsage {
  kind: string | number;
  shardId: string;
  name: string;
  sizeMb: number | string;
  deleted: boolean;
  displayName: string;
  limitMb?: number | string;
}

export interface DatastoreUsage {
  datastoreId: string;
  totalUsedMb: number | string;
  driveFreeMb: number | string;
  driveTotalMb: number | string;
  shards: ShardDiskUsage[];
}

export interface DatastoreUsageReport {
  spireId: string;
  scannedAt: string;
  datastores: DatastoreUsage[];
}

/** `GET /api/Spires/roster`: every machine with whether it's online and its AMP version. */
export function getSpireRoster(client: AmpClient): Promise<SpireRosterItem[]> {
  return client.request<SpireRosterItem[]>("/api/Spires/roster");
}

/** `GET /api/Spires/{id}/startup`: its instances in boot order. */
export function getSpireStartup(client: AmpClient, id: string): Promise<SpireStartupEntry[]> {
  return client.request<SpireStartupEntry[]>(`/api/Spires/${encodeURIComponent(id)}/startup`);
}

/** `GET /api/Spires/{id}/ports`: every port its instances use, listening or clashing. */
export function getSpirePorts(client: AmpClient, id: string): Promise<SpirePortEntry[]> {
  return client.request<SpirePortEntry[]>(`/api/Spires/${encodeURIComponent(id)}/ports`);
}

/** `GET /api/Spires/{id}/datastores`: where it keeps instances' files. */
export function getSpireDatastores(client: AmpClient, id: string): Promise<SpireDatastore[]> {
  return client.request<SpireDatastore[]>(`/api/Spires/${encodeURIComponent(id)}/datastores`);
}

/** `GET /api/Spires/{id}/usage`: the latest disk scan (~10 min); null before the first. */
export async function getSpireUsage(client: AmpClient, id: string): Promise<DatastoreUsageReport | null> {
  const report = await client.request<DatastoreUsageReport | undefined>(`/api/Spires/${encodeURIComponent(id)}/usage`);
  return report && typeof report === "object" ? report : null;
}

/** "Cgnat" → "Carrier-grade NAT" etc.; enums can come as numbers, which say nothing, so they're dropped. */
export function reachabilityLabel(value: string | number | undefined): string | null {
  if (typeof value !== "string") return null;
  return { Direct: "Direct (no NAT)", Nat: "Behind NAT", Cgnat: "Carrier-grade NAT", Unknown: null }[value] ?? value;
}
