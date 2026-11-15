import { host } from "nsh";

/**
 * The phone's key store, for the vault: keys made inside Android's Keystore that never leave
 * the phone, reached through the Android app around the TSX app (android/, DeviceKeys.java).
 * Elsewhere (tests without a host, `nsh run`, desktops) there are no device keys and the
 * vault uses the PIN alone.
 *
 * Kinds: "bound" works without the user (it ties the PIN vault to this phone); "quick" works
 * within a minute of the phone being unlocked; "biometric" works once per fingerprint or
 * face check, and is voided when a fingerprint or face is added to the phone.
 *
 * Errors start with a kind: "auth:", "invalid:", "missing:", "cancel:", "lockout:",
 * "unavailable:", "busy:" or "error:".
 */

export type KeyKind = "bound" | "quick" | "biometric";
export type Biometric = "ready" | "notEnrolled" | "unavailable";
export interface PromptText {
  title: string;
  subtitle?: string;
  /** The button that closes the prompt. */
  cancel?: string;
}

const NONE = { keys: false, biometric: "unavailable" as Biometric };

/** What the phone can do: device keys, and whether strong biometrics are set up now. Never throws. */
export async function deviceStatus(): Promise<{ keys: boolean; biometric: Biometric }> {
  try {
    if (!host.available()) return NONE;
    const s = ((await host.call("deviceKey.status", null, { timeout: 5000 })) ?? {}) as Record<string, unknown>;
    const biometric = s.biometric === "ready" || s.biometric === "notEnrolled" ? s.biometric : "unavailable";
    return { keys: s.keys === true, biometric };
  } catch {
    return NONE;
  }
}

/** Whether the phone keeps keys for the vault. Never throws. */
export async function deviceKeysAvailable(): Promise<boolean> {
  return (await deviceStatus()).keys;
}

/** The host's message without NSH's wrapping, so callers can read its kind. */
function reason(e: unknown): Error {
  const m = String((e as Error)?.message ?? e);
  const at = m.search(/(auth|invalid|missing|cancel|lockout|unavailable|busy|error):/);
  return new Error(at > 0 ? m.slice(at) : m);
}

/** Encrypts `data` (base64) with the key `alias`, made on first use. A biometric key shows the prompt. */
export async function sealWith(alias: string, data: string, kind: KeyKind, prompt?: PromptText): Promise<string> {
  try {
    // A prompt waits on the user, with no time limit.
    const sealed = await host.call("deviceKey.seal", { alias, data, kind, prompt: prompt ?? null }, { timeout: kind === "biometric" ? 0 : 30000 });
    if (typeof sealed !== "string") throw new Error("error: no sealed value");
    return sealed;
  } catch (e) {
    throw reason(e);
  }
}

/** Decrypts what `sealWith` returned, back to base64; `prompt` for a biometric key. */
export async function openWith(alias: string, sealed: string, prompt?: PromptText): Promise<string> {
  try {
    const plain = await host.call("deviceKey.open", { alias, sealed, prompt: prompt ?? null }, { timeout: prompt ? 0 : 30000 });
    if (typeof plain !== "string") throw new Error("error: nothing opened");
    return plain;
  } catch (e) {
    throw reason(e);
  }
}

/** Deletes the key `alias`: nothing it sealed opens again. */
export async function forgetKey(alias: string): Promise<boolean> {
  try {
    return (await host.call("deviceKey.forget", { alias })) === true;
  } catch {
    return false;
  }
}
