import { host } from "nsh";

/**
 * "Block screenshots": Android's FLAG_SECURE, set by the Android app around the TSX app
 * (MainActivity.java), which keeps the choice itself so it applies before the first frame
 * of every launch. With it on, screenshots and screen recordings of the app come out blank
 * and the app switcher shows no snapshot. Without that host (tests without one, `nsh run`,
 * desktops) there's nothing to set: `screenGuard()` answers null.
 */

/** Whether screenshots are blocked now, or null where the app can't block them. Never throws. */
export async function screenGuard(): Promise<boolean | null> {
  try {
    if (!host.available()) return null;
    const on = await host.call("screen.secure.get", null, { timeout: 5000 });
    return typeof on === "boolean" ? on : null;
  } catch {
    return null;
  }
}

/** Blocks or allows screenshots; resolves with what's in force afterwards. */
export async function setScreenGuard(on: boolean): Promise<boolean> {
  const now = await host.call("screen.secure.set", { on }, { timeout: 5000 });
  if (typeof now !== "boolean") throw new Error("The app couldn't change that setting.");
  return now;
}
