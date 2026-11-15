import type { ApiError, ProblemDetails } from "./types";

/** An AMP request that came back with a non-2xx status, or never reached the server. */
export class AmpError extends Error {
  /** HTTP status; 0 when the request never got a response (offline, DNS, TLS, timeout). */
  readonly status: number;
  /** AMP's error code (`ApiError.code`), when the server sent one. */
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "AmpError";
    this.status = status;
    this.code = code;
  }

  get isUnauthorized() {
    return this.status === 401;
  }
}

/**
 * Normalizes what the user typed as their server address into an origin the client
 * can append `/api/...` to: adds `defaultScheme` (https unless the user picked http) when
 * no scheme is given and drops any trailing slashes. Only http and https are accepted; the
 * add-server form asks for an explicit acknowledgement before it saves an http address.
 * An address with a user name or password in it, a query or a fragment is refused rather
 * than silently changed.
 */
export function normalizeServerUrl(input: string, defaultScheme: "https" | "http" = "https"): string {
  let value = input.trim();
  if (!value) throw new Error("Enter your AMP server's address");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `${defaultScheme}://${value}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("That doesn't look like a valid address");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("The address must start with https:// or http://");
  if (url.username || url.password) throw new Error("Leave the user name and password out of the address");
  if (url.search || url.hash) throw new Error("Leave out anything after ? or # in the address");
  if (!url.hostname) throw new Error("That doesn't look like a valid address");
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

export type HostKind = "tailscale" | "private" | "public";

/** Whether an address looks like Tailscale, a private network or the public internet: how hard to warn about plain http. */
export function hostKind(address: string): HostKind {
  let host: string;
  try {
    host = new URL(address).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return "public";
  }
  if (host.endsWith(".ts.net")) return "tailscale";
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 100 && b >= 64 && b <= 127) return "tailscale";
    if (a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) return "private";
    return "public";
  }
  if (host.includes(":")) {
    if (host.startsWith("fd7a:115c:a1e0")) return "tailscale";
    return host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd") ? "private" : "public";
  }
  if (host === "localhost" || !host.includes(".") || /\.(local|lan|home|internal|home\.arpa)$/.test(host)) return "private";
  return "public";
}

/** Biggest response the app reads into memory (file downloads go to the browser instead). */
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

/**
 * Reads a response body, never holding more than `max` bytes: a declared length over the cap
 * is refused up front, and a body that has no length (chunked) or understates it is cut off
 * the moment it crosses the cap, so a hostile or broken server can't make the app buffer an
 * endless answer before the size check runs.
 */
export async function readCapped(response: Response, max: number): Promise<Uint8Array> {
  const tooLarge = () => new AmpError("The server's answer is too large to read", response.status);
  if (Number(response.headers.get("content-length") ?? 0) > max) throw tooLarge();
  const stream = response.body;
  if (!stream) {
    // No stream to count (an empty body, or a host that doesn't give one): read it, then check.
    const all = new Uint8Array(await response.arrayBuffer());
    if (all.length > max) throw tooLarge();
    return all;
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) {
        await reader.cancel().catch(() => {});
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * An error message with any secret a URL in it carries (a hub ticket, a download ticket,
 * a token) cut out, since messages are shown on screen.
 */
export function redact(message: string): string {
  return message.replace(/([?&](?:access_token|ticket|token|key)=)[^&\s"')]+/gi, "$1…");
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Sent as JSON. */
  body?: unknown;
  /** Sent as is, as `application/octet-stream` (an upload chunk). */
  raw?: Blob | Uint8Array;
  /** An array repeats the key once per value (`shard=a&shard=b`). */
  query?: Record<string, string | number | boolean | string[] | undefined>;
  /** Milliseconds before the request is abandoned. Default 15 s. */
  timeoutMs?: number;
  /** Send without the session token (sign-in, capabilities). */
  anonymous?: boolean;
}

/**
 * A thin `fetch` wrapper bound to one AMP server. Paths are passed exactly as the spec
 * spells them; AMP 3 mixes `/api/Shards` and `/api/shards`.
 */
export class AmpClient {
  readonly baseUrl: string;
  token: string | null;

  constructor(baseUrl: string, token: string | null = null) {
    this.baseUrl = normalizeServerUrl(baseUrl);
    this.token = token;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = "GET", body, raw, query, timeoutMs = 15_000, anonymous = false } = options;

    let url = `${this.baseUrl}${path}`;
    if (query) {
      const params = Object.entries(query)
        .filter(([, v]) => v !== undefined)
        .flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((one) => `${encodeURIComponent(k)}=${encodeURIComponent(String(one))}`));
      if (params.length) url += `?${params.join("&")}`;
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (raw !== undefined) headers["Content-Type"] = "application/octet-stream";
    else if (body !== undefined) headers["Content-Type"] = "application/json";
    if (!anonymous && this.token) headers.Authorization = `Bearer ${this.token}`;

    const controller = new AbortController();
    // The deadline covers the whole exchange, the answer's body included: a server that
    // sends headers and then stalls mustn't hang the screen.
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    let text: string;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        // AMP's API never redirects. Refusing keeps the Authorization header from
        // following a redirect to another host.
        redirect: "error",
      });
      text = new TextDecoder().decode(await readCapped(response, MAX_RESPONSE_BYTES));
    } catch (error) {
      if (error instanceof AmpError) throw error;
      const aborted = controller.signal.aborted;
      throw new AmpError(
        aborted ? "The server took too long to respond" : `Couldn't reach the server: ${describe(error)}`,
        0,
      );
    } finally {
      clearTimeout(timer);
    }

    const data = text ? safeJson(text) : undefined;

    if (!response.ok) {
      throw new AmpError(errorMessage(response.status, data), response.status, (data as ApiError)?.code);
    }
    return data as T;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function describe(error: unknown): string {
  return redact(error instanceof Error ? error.message : String(error));
}

function errorMessage(status: number, data: unknown): string {
  if (data && typeof data === "object") {
    const problem = data as ProblemDetails & Partial<ApiError>;
    const message = problem.detail || problem.message || problem.title;
    if (typeof message === "string" && message) return message.length > 500 ? `${message.slice(0, 500)}…` : message;
  }
  // A plain-text answer (often a proxy's error page): its text, without markup, kept short.
  if (typeof data === "string" && data.trim()) {
    const plain = data.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (plain) return plain.length > 300 ? `${plain.slice(0, 300)}…` : plain;
  }
  if (status === 401) return "Your session has expired. Sign in again.";
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404) return "Not found. Is this an AMP 3 server?";
  if (status === 429) return "Too many attempts. Wait a moment and try again.";
  return `The server answered with HTTP ${status}`;
}
