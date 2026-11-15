import { host } from "nsh";

/**
 * Asks the Android app to keep this window out of screenshots, screen recordings and the
 * recents list. Does nothing where there is no Android app around the TSX app.
 */
export async function setCaptureBlocked(on: boolean): Promise<void> {
  try {
    if (!host.available()) return;
    await host.call("window.secure", { on }, { timeout: 5000 });
  } catch {
    // No Android app answers: nothing to block.
  }
}
