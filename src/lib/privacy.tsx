import { signal, Storage, Text } from "nsh";

/**
 * "Hide personal details" (Security): for screenshots, screen sharing and streams. While it's
 * on, addresses (the panel's, IPs, host names, connect addresses), account and player names
 * and email addresses are drawn as a blurred stand-in of the same shape. The real text isn't
 * drawn at all, so nothing can be read by zooming into a capture, and it holds on phones that
 * can't blur (below Android 12), where the stand-in shows as dots. Copy buttons still copy
 * the real value. Fields being edited show what's typed.
 */
export const hideDetails = signal(false);

const KEY = "amp.privacy";

export async function loadPrivacy(): Promise<void> {
  try {
    const raw = await Storage.getItem(KEY);
    hideDetails.set(raw ? JSON.parse(raw)?.hideDetails === true : false);
  } catch {
    hideDetails.set(false);
  }
}

export async function setHideDetails(on: boolean): Promise<void> {
  hideDetails.set(on);
  await Storage.setItem(KEY, JSON.stringify({ hideDetails: on }));
}

/** Letters and digits as dots, keeping separators (. : / @ - and spaces), so the shape stays. */
export function masked(text: string): string {
  return text.replace(/[\p{L}\p{N}_]/gu, "•");
}

/** The text, or its stand-in while details are hidden. For text inside a longer line. */
export function priv(text: string | null | undefined): string {
  if (!text) return text ?? "";
  return hideDetails() ? masked(text) : text;
}

/**
 * IPv4 and IPv6 addresses anywhere in a line of text. IPv6 only in its full form (eight groups) or
 * compressed with "::", so times like 12:34:56 aren't taken for one.
 */
const IP_IN_TEXT =
  /\b(?:\d{1,3}\.){3}\d{1,3}\b|\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b|(?:\b(?:[0-9a-f]{1,4}:){1,6}|(?<![\w:]):):(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,5})?(?![\w:])/gi;

/** The line with the IP addresses in it dotted out while details are hidden (console output, say). */
export function privIps(text: string): string {
  return hideDetails() ? text.replace(IP_IN_TEXT, (ip) => masked(ip)) : text;
}

/** A personal detail on its own line or chip: its stand-in is also blurred while hidden. */
export function Private(props: { text: string | null | undefined; class?: string; testID?: string }) {
  return (
    <Text testID={props.testID} class={`${props.class ?? ""} ${hideDetails() ? "blur-[3px]" : ""}`} accessibilityLabel={hideDetails() ? "Hidden" : undefined}>
      {priv(props.text)}
    </Text>
  );
}
