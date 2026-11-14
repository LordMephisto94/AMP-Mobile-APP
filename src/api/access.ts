import type { AmpClient } from "./client";

/**
 * Who can use the panel: user accounts, the named roles that grant them permissions, and
 * one-time invites. Each call needs its own capability (users-read, users-edit,
 * roles-read, users-invite, ...), and nobody can act on an account with more authority
 * than their own.
 */

export interface User {
  id: string;
  userName: string | null;
  displayName: string | null;
  email: string | null;
  roleIds: string[];
  isAdmin: boolean;
  suspended: boolean;
  passwordExpires: boolean;
  requirePasswordChange: boolean;
  createdAt: string | null;
  lastLoginAt: string | null;
}

export interface Role {
  id: string;
  name: string | null;
  description: string | null;
  /** Permission-node grants, e.g. `shard.*.view`. */
  permissions: string[];
  createdAt: string;
}

export interface Invite {
  id: string;
  userName: string;
  displayName: string | null;
  roleIds: string[];
  createdByName: string | null;
  createdAt: string;
  expiresAt: string;
  accepted: boolean;
  acceptedAt: string | null;
  /** pending, expired or accepted. */
  status: string;
}

export interface UserChanges {
  displayName?: string | null;
  email?: string | null;
  roleIds?: string[] | null;
  suspended?: boolean | null;
  passwordExpires?: boolean | null;
  requirePasswordChange?: boolean | null;
}

export interface NewUser {
  userName: string;
  password: string;
  displayName?: string | null;
  email?: string | null;
  roleIds?: string[];
  requirePasswordChange?: boolean;
}

export const listUsers = (c: AmpClient) => c.request<User[]>("/api/users");
export const listRoles = (c: AmpClient) => c.request<Role[]>("/api/roles");
export const listInvites = (c: AmpClient) => c.request<Invite[]>("/api/invites");

export function getUser(c: AmpClient, id: string): Promise<User> {
  return c.request<User>(`/api/users/${encodeURIComponent(id)}`);
}

/** `PUT /api/users/{id}`: only the fields given change. Suspending or forcing a password change signs them out. */
export function updateUser(c: AmpClient, id: string, changes: UserChanges): Promise<User> {
  return c.request<User>(`/api/users/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: {
      displayName: changes.displayName ?? null,
      email: changes.email ?? null,
      roleIds: changes.roleIds ?? null,
      suspended: changes.suspended ?? null,
      passwordExpires: changes.passwordExpires ?? null,
      requirePasswordChange: changes.requirePasswordChange ?? null,
    },
  });
}

export function createUser(c: AmpClient, user: NewUser): Promise<User> {
  return c.request<User>("/api/users", {
    method: "POST",
    body: {
      userName: user.userName,
      password: user.password,
      displayName: user.displayName || null,
      email: user.email || null,
      roleIds: user.roleIds ?? [],
      passwordExpires: false,
      requirePasswordChange: user.requirePasswordChange ?? false,
    },
  });
}

/** Sets a new password and signs them out everywhere, SFTP included. */
export async function resetPassword(c: AmpClient, id: string, newPassword: string): Promise<void> {
  await c.request(`/api/users/${encodeURIComponent(id)}/reset-password`, { method: "POST", body: { newPassword } });
}

/** Ends all their sessions; they can sign straight back in. */
export async function signOutUser(c: AmpClient, id: string): Promise<void> {
  await c.request(`/api/users/${encodeURIComponent(id)}/logout`, { method: "POST" });
}

/** Deletes the account, its passkeys, preferences and schedules. Returns what couldn't be removed. */
export async function deleteUser(c: AmpClient, id: string): Promise<string[]> {
  const result = await c.request<{ warnings?: { message?: string; code?: string }[] } | undefined>(`/api/users/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return (result?.warnings ?? []).map((w) => w.message || w.code || "Something wasn't removed");
}

/** A new invite and its link: the code is shown this once and never again. */
export async function createInvite(
  c: AmpClient,
  invite: { userName: string; displayName?: string; roleIds: string[]; expiresInHours: number },
): Promise<{ invite: Invite; link: string }> {
  const created = await c.request<{ invite: Invite; token: string }>("/api/invites", {
    method: "POST",
    body: { userName: invite.userName, displayName: invite.displayName || null, roleIds: invite.roleIds, expiresInHours: invite.expiresInHours },
  });
  return { invite: created.invite, link: inviteLink(c, created.token) };
}

/** Makes an expired invite usable again, with a new code. */
export async function rearmInvite(c: AmpClient, id: string): Promise<{ invite: Invite; link: string }> {
  const created = await c.request<{ invite: Invite; token: string }>(`/api/invites/${encodeURIComponent(id)}/rearm`, { method: "POST" });
  return { invite: created.invite, link: inviteLink(c, created.token) };
}

export async function revokeInvite(c: AmpClient, id: string): Promise<void> {
  await c.request(`/api/invites/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** The link the web panel gives out for an invite code. */
function inviteLink(c: AmpClient, token: string): string {
  return `${c.baseUrl}/invite?token=${encodeURIComponent(token)}`;
}
