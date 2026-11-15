import type { AmpClient } from "./client";

/**
 * An instance's files, as the web panel's file manager reaches them: everything under
 * `/api/shards/{id}/files`, paths relative to the instance's working directory with
 * forward slashes ("" is the root).
 */

/** `FileEntry`. */
export interface FileEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  isLink?: boolean;
  /** Bytes; 0 for folders. May arrive as a string. */
  size?: number | string;
  modified?: string;
}

/** `ManagedFileDto`: a file AMP writes from the instance's settings. */
export interface ManagedFile {
  path: string;
  /** `generated`: rewritten on every start (read-only); `merged`: AMP writes only its own values. */
  kind: "generated" | "merged" | string;
  importable: boolean;
  source: string;
  fieldName?: string | null;
}

/** `ExtractResultDto`, also what a copy returns. */
export interface ExtractResult {
  extracted: number;
  skippedOnDisk: number;
  skippedDenied: number;
  skippedBlocked: number;
  skippedManaged: number;
  examples: string[];
}

const base = (id: string) => `/api/shards/${encodeURIComponent(id)}/files`;

/** Characters a file name can't hold, or `.`/`..` (which would leave the folder). */
const BAD_NAME = /[\\/:*?"<>|\u0000-\u001f]|^\.\.?$/;
/** The biggest file the app uploads; larger ones go by SFTP or the web panel. */
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

/** Why a file or folder name can't be used, or nothing when it can. */
export function nameProblem(name: string): string | void {
  if (!name) return "Enter a name";
  if (name.length > 255) return "That name is too long";
  if (BAD_NAME.test(name)) return "Names can't contain / \\ : * ? \" < > |";
}

export function joinPath(dir: string, name: string): string {
  return dir ? `${dir.replace(/\/+$/, "")}/${name}` : name;
}

export function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/** `GET files?path=`: a folder's entries, without what the caller can't read. */
export function listFiles(client: AmpClient, id: string, path: string): Promise<FileEntry[]> {
  return client.request<FileEntry[]>(base(id), { query: { path } });
}

/** `GET files/start`: the folder the panel's file manager opens at. */
export async function startFolder(client: AmpClient, id: string): Promise<string> {
  return (await client.request<{ path: string }>(`${base(id)}/start`)).path ?? "";
}

/** `GET files/managed?path=`: the AMP-managed config files in a folder. */
export function managedFiles(client: AmpClient, id: string, path: string): Promise<ManagedFile[]> {
  return client.request<ManagedFile[]>(`${base(id)}/managed`, { query: { path } });
}

/** `GET files/content?path=`: a text file's content. */
export async function readText(client: AmpClient, id: string, path: string): Promise<string> {
  return (await client.request<{ content: string }>(`${base(id)}/content`, { query: { path }, timeoutMs: 30_000 })).content ?? "";
}

/** `PUT files/content?path=`: replaces (or creates) a text file. */
export async function writeText(client: AmpClient, id: string, path: string, content: string): Promise<void> {
  await client.request<void>(`${base(id)}/content`, { method: "PUT", query: { path }, body: { content }, timeoutMs: 30_000 });
}

/** `POST files/folder`. */
export async function createFolder(client: AmpClient, id: string, path: string): Promise<void> {
  await client.request<void>(`${base(id)}/folder`, { method: "POST", body: { path } });
}

/** `POST files/move`: move or rename. */
export async function moveFile(client: AmpClient, id: string, from: string, to: string): Promise<void> {
  await client.request<void>(`${base(id)}/move`, { method: "POST", body: { from, to } });
}

/** `POST files/copy`. */
export function copyFile(client: AmpClient, id: string, from: string, to: string): Promise<ExtractResult> {
  return client.request<ExtractResult>(`${base(id)}/copy`, { method: "POST", body: { from, to }, timeoutMs: 120_000 });
}

/** `DELETE files?path=`: a file, or a folder with everything in it. */
export async function deleteFile(client: AmpClient, id: string, path: string): Promise<void> {
  await client.request<void>(base(id), { method: "DELETE", query: { path }, timeoutMs: 60_000 });
}

/** `POST files/extract`: unpacks an archive next to it (or into `destination`). */
export function extractArchive(client: AmpClient, id: string, path: string, overwrite = false): Promise<ExtractResult> {
  return client.request<ExtractResult>(`${base(id)}/extract`, {
    method: "POST",
    body: { path, destination: null, overwrite },
    timeoutMs: 300_000,
  });
}

/** `POST files/archive`: zips paths into `destination` (which should end in .zip). */
export async function createArchive(client: AmpClient, id: string, paths: string[], destination: string): Promise<void> {
  await client.request<void>(`${base(id)}/archive`, { method: "POST", body: { paths, destination }, timeoutMs: 300_000 });
}

/**
 * A one-time download link: `POST files/download-ticket` (or `zip-ticket` for a folder),
 * then the URL with `?ticket=`, which a browser can open without the session token.
 */
export async function downloadUrl(client: AmpClient, id: string, entry: FileEntry): Promise<string> {
  if (entry.isDirectory) {
    const { ticket } = await client.request<{ ticket: string }>(`${base(id)}/zip-ticket`, { method: "POST", body: { paths: [entry.path] } });
    return `${client.baseUrl}${base(id)}/zip?ticket=${encodeURIComponent(ticket)}`;
  }
  const { ticket } = await client.request<{ ticket: string }>(`${base(id)}/download-ticket`, { method: "POST", body: { path: entry.path } });
  return `${client.baseUrl}${base(id)}/download?path=${encodeURIComponent(entry.path)}&ticket=${encodeURIComponent(ticket)}`;
}

const CHUNK = 8 * 1024 * 1024;

/**
 * Uploads a file the chunked way the panel does: `upload-start` (which says how much a
 * resumed session already has), 8 MB `upload-chunk`s, then `upload-commit`.
 */
export async function uploadFile(
  client: AmpClient,
  id: string,
  dir: string,
  file: Blob & { name: string },
  onProgress?: (loaded: number, total: number) => void,
  /** Asked before each chunk: true stops the upload (the app locked), uncommitted. */
  stop?: () => boolean,
): Promise<void> {
  // A picked file's name comes from the phone's file provider: checked like a typed one.
  const problem = nameProblem(file.name);
  if (problem) throw new Error(`${file.name}: ${problem}`);
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name} is over 512 MB. Use SFTP or the web panel for big files.`);
  const path = joinPath(dir, file.name);
  const start = await client.request<{ sessionId: string; received?: number }>(`${base(id)}/upload-start`, {
    method: "POST",
    body: { path, size: file.size },
  });
  if (typeof start?.sessionId !== "string" || !start.sessionId) throw new Error("The server didn't start the upload");
  // A count the server gives is only believed when it's a whole number within the file:
  // anything else would end the loop early and commit a partial file as if it were whole.
  const count = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= file.size ? n : null;
  };
  const resumed = start.received === undefined || start.received === null ? 0 : count(start.received);
  if (resumed === null) throw new Error("The server's upload answer didn't make sense");
  let received: number = resumed;
  onProgress?.(received, file.size);
  while (received < file.size) {
    if (stop?.()) throw new Error("Upload stopped: the app locked. Upload it again after unlocking.");
    const chunk = file.slice(received, received + CHUNK);
    const result = await client.request<{ received: number }>(`${base(id)}/upload-chunk`, {
      method: "POST",
      query: { session: start.sessionId },
      raw: chunk,
      timeoutMs: 300_000,
    });
    const next: number | null = result?.received === undefined || result?.received === null ? Math.min(file.size, received + chunk.size) : count(result.received);
    if (next === null) throw new Error("The server's upload answer didn't make sense");
    if (next <= received) throw new Error("The upload stopped making progress");
    received = next;
    onProgress?.(received, file.size);
  }
  if (stop?.()) throw new Error("Upload stopped: the app locked. Upload it again after unlocking.");
  await client.request<void>(`${base(id)}/upload-commit`, { method: "POST", query: { session: start.sessionId }, timeoutMs: 120_000 });
}

/** Files the editor opens as text. */
const TEXT_EXTENSIONS = new Set(
  (
    "txt log cfg conf config ini json json5 jsonc yml yaml toml xml properties env sh bat cmd ps1 lua js ts py " +
    "md csv tsv sql html htm css txt ban whitelist ops lst list dat2 mcmeta motd vdf acf kvp cs java"
  ).split(" "),
);

export function isTextFile(entry: FileEntry): boolean {
  if (entry.isDirectory) return false;
  const dot = entry.name.lastIndexOf(".");
  if (dot < 0) return Number(entry.size ?? 0) < 512 * 1024; // extensionless: small files are usually text
  return TEXT_EXTENSIONS.has(entry.name.slice(dot + 1).toLowerCase());
}

export function isArchive(entry: FileEntry): boolean {
  return !entry.isDirectory && /\.(zip|7z|rar|tar|tgz|tar\.gz|gz|bz2|xz)$/i.test(entry.name);
}

export { formatBytes } from "../lib/units";
