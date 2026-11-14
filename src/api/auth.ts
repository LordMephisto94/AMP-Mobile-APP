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
