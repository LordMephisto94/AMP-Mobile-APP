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
 * can append `/api/...` to: adds `https://` when no scheme is given and drops any
 * trailing slashes. Throws if the result is not a valid http(s) URL.
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
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("The address must start with https:// or http://");
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Sent as JSON. */
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
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
    const { method = "GET", body, query, timeoutMs = 15_000, anonymous = false } = options;

    let url = `${this.baseUrl}${path}`;
    if (query) {
      const params = Object.entries(query)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
      if (params.length) url += `?${params.join("&")}`;
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (!anonymous && this.token) headers.Authorization = `Bearer ${this.token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = controller.signal.aborted;
      throw new AmpError(
        aborted ? "The server took too long to respond" : `Couldn't reach the server: ${describe(error)}`,
        0,
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
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
  return error instanceof Error ? error.message : String(error);
}

function errorMessage(status: number, data: unknown): string {
  if (data && typeof data === "object") {
    const problem = data as ProblemDetails & Partial<ApiError>;
    const message = problem.detail || problem.message || problem.title;
    if (message) return message;
  }
  if (typeof data === "string" && data.trim()) return data.trim();
  if (status === 401) return "Your session has expired. Sign in again.";
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404) return "Not found. Is this an AMP 3 server?";
  if (status === 429) return "Too many attempts. Wait a moment and try again.";
  return `The server answered with HTTP ${status}`;
}
