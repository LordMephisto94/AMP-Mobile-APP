import { setColorScheme, signal, Storage } from "nsh";
import { setCaptureBlocked } from "../lib/windowFlags";

/**
 * The app's own preferences: how it looks, how numbers are written, and what it hides. Not
 * secret, so plain JSON in storage (the PIN and saved sign-ins live in the vault instead).
 */
export type ThemeMode = "dark" | "light" | "system";
export type SizeUnits = "binary" | "decimal";
export type SpeedUnits = "bytes" | "bits";
export type HideIps = "off" | "tap" | "always";

const KEY = "amp.prefs";

/** Dark unless the user picks another: the artwork was made for it. */
export const themeMode = signal<ThemeMode>("dark");
/** Binary counts in 1024s (KiB, MiB, GiB), decimal in 1000s (kB, MB, GB). */
export const sizeUnits = signal<SizeUnits>("binary");
export const speedUnits = signal<SpeedUnits>("bytes");
export const hideIps = signal<HideIps>("off");
/** Android only: keep screenshots, screen recording and the recents picture blank. */
export const blockCapture = signal(false);
/** Addresses the user tapped open this session, by their real text. */
const revealed = signal<ReadonlySet<string>>(new Set());

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

async function save(): Promise<void> {
  await Storage.setItem(
    KEY,
    JSON.stringify({ themeMode: themeMode(), sizeUnits: sizeUnits(), speedUnits: speedUnits(), hideIps: hideIps(), blockCapture: blockCapture() }),
  );
}

/** Reads the saved preferences at launch and applies the theme and the screenshot block. */
export async function loadPrefs(): Promise<void> {
  try {
    const raw = await Storage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : null;
    themeMode.set(pick(v?.themeMode, ["dark", "light", "system"] as const, "dark"));
    sizeUnits.set(pick(v?.sizeUnits, ["binary", "decimal"] as const, "binary"));
    speedUnits.set(pick(v?.speedUnits, ["bytes", "bits"] as const, "bytes"));
    hideIps.set(pick(v?.hideIps, ["off", "tap", "always"] as const, "off"));
    blockCapture.set(v?.blockCapture === true);
  } catch {
    // Unreadable: the defaults stand.
  }
  setColorScheme(themeMode());
  if (blockCapture()) await setCaptureBlocked(true);
}

export async function setThemeMode(mode: ThemeMode): Promise<void> {
  themeMode.set(mode);
  setColorScheme(mode);
  await save();
}

export async function setSizeUnits(units: SizeUnits): Promise<void> {
  sizeUnits.set(units);
  await save();
}

export async function setSpeedUnits(units: SpeedUnits): Promise<void> {
  speedUnits.set(units);
  await save();
}

export async function setHideIps(mode: HideIps): Promise<void> {
  hideIps.set(mode);
  clearRevealed();
  await save();
}

export async function setBlockCapture(on: boolean): Promise<void> {
  blockCapture.set(on);
  await setCaptureBlocked(on);
  await save();
}

// ---- Hiding addresses ----------------------------------------------------------------------

/** Host names, IPv4 addresses and IPv6 addresses (a port after them stays readable). */
const ADDRESS = /[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+|\[[0-9A-Fa-f:]+\]|(?:[0-9A-Fa-f]{0,4}:){2,}[0-9A-Fa-f]{0,4}/g;

/** "203.0.113.7:2001" as "•••:2001". */
export function maskAddress(text: string): string {
  return text.replace(ADDRESS, "•••");
}

/** Whether `raw` is hidden now: hiding is on, and it was not tapped open (in "tap" mode). */
export function isMasked(raw: string): boolean {
  return hideIps() !== "off" && !(hideIps() === "tap" && revealed().has(raw));
}

/** What to draw for an address: as it is, or hidden by the setting. */
export function shownAddress(raw: string): string {
  return isMasked(raw) ? maskAddress(raw) : raw;
}

/**
 * A press on a hidden address: in "tap" mode the first one shows it, later ones (and every
 * press in "always" mode) run `action`, which still uses the real address.
 */
export function pressAddress(raw: string, action: () => void): void {
  if (hideIps() === "tap" && isMasked(raw)) revealed.set(new Set([...revealed(), raw]));
  else action();
}

/** Hides everything shown by a tap again (the app locked, or the setting changed). */
export function clearRevealed(): void {
  if (revealed().size) revealed.set(new Set());
}
