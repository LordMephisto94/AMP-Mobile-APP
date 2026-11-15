import type { AmpClient } from "./client";
import type { AuthResponse, HubTokenResponse, LoginOutcome, LoginRequest } from "./types";

/**
 * `POST /api/Auth/login`. A 200 is a token, or a marker that the account must change
 * its password or sign in with a passkey. The markers are only described in prose in
 * the spec, so both PascalCase and camelCase spellings are accepted.
 */
export async function login(client: AmpClient, request: LoginRequest): Promise<LoginOutcome> {
  const data = await client.request<Record<string, unknown>>("/api/Auth/login", {
    method: "POST",
    body: request,
    anonymous: true,
  });
  return readLoginAnswer(data);
}

/**
 * `POST /api/Auth/change-expired-password`: for an account held by a required password
 * change. Proves who it is with the current password, sets the new one, and goes on as a
 * sign-in would (other sessions are ended). When the answer carries no token, the app
 * signs in with the new password.
 */
export async function changeExpiredPassword(
  client: AmpClient,
  request: { username: string; currentPassword: string; newPassword: string; rememberMe: boolean },
): Promise<LoginOutcome> {
  const data = await client.request<Record<string, unknown> | undefined>("/api/Auth/change-expired-password", {
    method: "POST",
    body: { username: request.username, currentPassword: request.currentPassword, newPassword: request.newPassword },
    anonymous: true,
  });
  if (data && typeof data === "object" && (typeof data.token === "string" || data.passkeyRequired || data.PasskeyRequired)) return readLoginAnswer(data);
  return login(client, { username: request.username, password: request.newPassword, rememberMe: request.rememberMe });
}

export interface PasswordPolicy {
  requiredLength?: number;
  requiredUniqueChars?: number;
  requireUppercase?: boolean;
  requireLowercase?: boolean;
  requireDigit?: boolean;
  requireNonAlphanumeric?: boolean;
}

/** `GET /api/Auth/password-policy`: what a new password must have, in a sentence. */
export async function passwordRules(client: AmpClient): Promise<string | null> {
  try {
    const p = await client.request<PasswordPolicy>("/api/Auth/password-policy", { anonymous: true });
    const parts: string[] = [];
    if (p?.requiredLength) parts.push(`at least ${p.requiredLength} characters`);
    if (p?.requireUppercase) parts.push("a capital letter");
    if (p?.requireLowercase) parts.push("a small letter");
    if (p?.requireDigit) parts.push("a digit");
    if (p?.requireNonAlphanumeric) parts.push("a symbol");
    if (p?.requiredUniqueChars && p.requiredUniqueChars > 1) parts.push(`${p.requiredUniqueChars} different characters`);
    return parts.length ? `Needs ${parts.join(", ")}.` : null;
  } catch {
    return null;
  }
}

function readLoginAnswer(data: Record<string, unknown> | undefined): LoginOutcome {
  if (typeof data?.token === "string") {
    return { kind: "signedIn", auth: data as unknown as AuthResponse };
  }
  if (data?.passwordChangeRequired || data?.PasswordChangeRequired) {
    const reason = (data.reason ?? data.Reason) as string | undefined;
    return { kind: "passwordChangeRequired", reason };
  }
  if (data?.passkeyRequired || data?.PasskeyRequired) {
    return { kind: "passkeyRequired" };
  }
  throw new Error("The server's sign-in response wasn't recognised. Is this an AMP 3 server?");
}

/** `POST /api/Auth/renew`: extends the session and returns a replacement token. */
export function renew(client: AmpClient): Promise<AuthResponse> {
  return client.request<AuthResponse>("/api/Auth/renew", { method: "POST" });
}

/** `POST /api/Auth/logout`: ends the current session on the server. */
export async function logout(client: AmpClient): Promise<void> {
  await client.request<void>("/api/Auth/logout", { method: "POST" });
}

/** `POST /api/auth/hub-token`: single-use ticket, valid 60 s, for each hub (re)connect. */
export function hubToken(client: AmpClient): Promise<HubTokenResponse> {
  return client.request<HubTokenResponse>("/api/auth/hub-token", { method: "POST" });
}
