import { signal, Storage } from "nsh";

/**
 * The app's own display preferences: how sizes and speeds are written. Not secret, so plain
 * JSON in storage (the PIN and saved sign-ins live in the vault instead).
 */
export type SizeUnits = "binary" | "decimal";
export type SpeedUnits = "bytes" | "bits";

const KEY = "amp.prefs";

/** Binary counts in 1024s, as AMP does (KB, MB, GB); decimal in 1000s (kB, MB, GB), as disk makers do. */
export const sizeUnits = signal<SizeUnits>("binary");
/** Network speeds in bytes per second, as AMP shows them, or bits per second, as internet plans are sold. */
export const speedUnits = signal<SpeedUnits>("bytes");

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

async function save(): Promise<void> {
  await Storage.setItem(KEY, JSON.stringify({ sizeUnits: sizeUnits(), speedUnits: speedUnits() }));
}

/** Reads the saved preferences at launch. */
export async function loadPrefs(): Promise<void> {
  try {
    const raw = await Storage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : null;
    sizeUnits.set(pick(v?.sizeUnits, ["binary", "decimal"] as const, "binary"));
    speedUnits.set(pick(v?.speedUnits, ["bytes", "bits"] as const, "bytes"));
  } catch {
    // Unreadable: the defaults stand.
  }
}

export async function setSizeUnits(units: SizeUnits): Promise<void> {
  sizeUnits.set(units);
  await save();
}

export async function setSpeedUnits(units: SpeedUnits): Promise<void> {
  speedUnits.set(units);
  await save();
}
