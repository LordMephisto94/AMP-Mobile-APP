import { Clipboard, openUrl } from "nsh";

/**
 * Links and images whose address comes from a server (release notes, a Steam profile,
 * template artwork) are opened or loaded only when they are plain `https:` addresses
 * with no credentials in them, and, where the caller says so, only on the hosts expected.
 * `nsh.json` grants `openUrl` for `https` alone, so this is the app's own check in front
 * of the runtime's.
 */
export function safeHttpsUrl(
  raw: string | null | undefined,
  hostAllowed?: (host: string) => boolean,
  /** Also plain http:// (a download from a plain-HTTP panel, whose host the caller pins). */
  allowPlain = false,
): string | null {
  if (!raw || typeof raw !== "string") return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const plainOk = allowPlain && !!hostAllowed && url.protocol === "http:";
  if ((url.protocol !== "https:" && !plainOk) || url.username || url.password || !url.hostname) return null;
  if (hostAllowed && !hostAllowed(url.hostname.toLowerCase())) return null;
  return url.href;
}

/** Whether `host` is `domain` or one of its subdomains. */
export function onDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Opens a server-supplied link in the browser, or throws when it isn't a safe one. */
export async function openSafe(raw: string | null | undefined, hostAllowed?: (host: string) => boolean, allowPlain = false): Promise<void> {
  const url = safeHttpsUrl(raw, hostAllowed, allowPlain);
  if (!url) throw new Error("That link isn't a secure https:// address, so it wasn't opened.");
  const { opened } = await openUrl(url);
  if (!opened) throw new Error("No browser on this device could open it.");
}

/**
 * Copies something secret (an invite link) and clears it from the clipboard after
 * `seconds`, unless something else was copied since.
 */
export async function copySecret(text: string, seconds = 60): Promise<void> {
  await Clipboard.writeText(text);
  setTimeout(async () => {
    try {
      if ((await Clipboard.readText()) === text) await Clipboard.writeText("");
    } catch {
      // The clipboard can't be read here: leave it.
    }
  }, seconds * 1000);
}
