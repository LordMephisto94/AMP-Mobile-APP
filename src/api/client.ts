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

/** Tailscale's ranges (100.64.0.0/10, fd7a:115c:a1e0::/48) and MagicDNS names under ts.net. */
export function isTailscaleHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    return [a, b, c, d].every((n) => n <= 255) && a === 100 && b >= 64 && b <= 127;
  }
  if (h.includes(":")) return h.startsWith("fd7a:115c:a1e0:");
  return h.endsWith(".ts.net") && h.length > ".ts.net".length;
}

export function isPlainHttp(serverUrl: string): boolean {
  return /^http:\/\//i.test(serverUrl);
}

/** Private, loopback and link-local addresses, `localhost`, `.local` and dotless names. */
function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = v4.slice(1).map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (h.includes(":")) return h === "::1" || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h);
  return h === "localhost" || h.endsWith(".local") || h.endsWith(".localhost") || !h.includes(".");
}

/**
 * How exposed a plain-HTTP address is: null if nothing is sent in the clear (HTTPS, or a Tailscale IP).
 * A `.ts.net` name is "tailnet": off the tailnet, public DNS can answer it (Tailscale Funnel).
 */
export function plainHttpRisk(serverUrl: string): "tailnet" | "local" | "public" | null {
  if (!isPlainHttp(serverUrl)) return null;
  let host: string;
  try {
    host = new URL(serverUrl).hostname;
  } catch {
    return "public";
  }
  if (isTailscaleHost(host)) return host.toLowerCase().endsWith(".ts.net") ? "tailnet" : null;
  return isLocalHost(host) ? "local" : "public";
}

/**
 * Normalizes what the user typed as their server address into an origin the client
 * can append `/api/...` to: adds `https://` when no scheme is given and drops any
 * trailing slashes. HTTPS is the default. Plain `http://` is taken when typed so: inside
 * Tailscale's tunnel it's encrypted anyway, and anywhere else the sign-in form warns first
 * (see `plainHttpRisk`). An address with a user name or password in it, a query or a
 * fragment is refused rather than silently changed.
 */
export function normalizeServerUrl(input: string): string {
  let value = input.trim();
  if (!value) throw new Error("Enter your AMP server's address");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("That doesn't look like a valid address");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("The address must start with https:// (or http://)");
  if (url.username || url.password) throw new Error("Leave the user name and password out of the address");
  if (url.search || url.hash) throw new Error("Leave out anything after ? or # in the address");
  if (!url.hostname) throw new Error("That doesn't look like a valid address");
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

/** Biggest response the app reads into memory (file downloads go to the browser instead). */
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

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
      const length = Number(response.headers.get("content-length") ?? 0);
      if (length > MAX_RESPONSE_BYTES) throw new AmpError("The server's answer is too large to read", response.status);
      text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) throw new AmpError("The server's answer is too large to read", response.status);
    } catch (error) {
      if (error instanceof AmpError) throw error;
      const aborted = controller.signal.aborted;
      throw new AmpError(
        aborted ? "The server took too long to respond" : connectionProblem(describe(error), this.baseUrl),
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

/** A failed connection in words a person can act on, the low-level reason kept at the end. */
export function connectionProblem(reason: string, baseUrl = ""): string {
  if (/InvalidContentType|wrong version number|http request|packet length too long|not an ssl|plaintext|record overflow/i.test(reason)) {
    let host = "";
    try {
      host = new URL(baseUrl).host;
    } catch {
      // no address to suggest
    }
    if (host && /^https:/i.test(baseUrl) && isTailscaleHost(new URL(baseUrl).hostname)) {
      return (
        `This address answered without HTTPS. It's a Tailscale address, so plain HTTP is safe here: add it as http://${host} ` +
        `(Tailscale encrypts the connection). (${reason})`
      );
    }
    return (
      "This address answered without HTTPS. Best: turn on HTTPS for the panel (a certificate, a reverse proxy or " +
      `Tailscale HTTPS). Or add it as http://${host || "…"} instead: the app will warn you first, since your password ` +
      `and session would then travel unencrypted. (${reason})`
    );
  }
  if (/certificate|UnknownIssuer|NotValidForName|InvalidCertificate|CERT_|self.signed|expired|BadSignature|hostname mismatch/i.test(reason)) {
    return (
      "This server's HTTPS certificate isn't trusted on this device: it's self-signed, expired, or issued for another " +
      `name. Give the panel a certificate from a trusted authority (Let's Encrypt, say) for the address you entered. (${reason})`
    );
  }
  return `Couldn't reach the server: ${reason}`;
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
