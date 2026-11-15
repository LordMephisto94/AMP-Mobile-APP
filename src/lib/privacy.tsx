import { signal, Storage, Text, View } from "nsh";

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
/** Bumped by every switch, so a load that finishes later never undoes it. */
let choices = 0;
/** The last write; the next one waits for it, so the disk ends with the last choice. */
let writing: Promise<void> = Promise.resolve();

/** Reads the choice. Launch awaits it before showing anything, so nothing flashes unhidden. */
export async function loadPrivacy(): Promise<void> {
  const before = choices;
  let on = false;
  try {
    const raw = await Storage.getItem(KEY);
    on = raw ? JSON.parse(raw)?.hideDetails === true : false;
  } catch {
    // Unreadable: shown as off, as it was never set.
  }
  if (choices === before) hideDetails.set(on);
}

export function setHideDetails(on: boolean): Promise<void> {
  choices++;
  hideDetails.set(on);
  const run = writing.then(() => Storage.setItem(KEY, JSON.stringify({ hideDetails: on })));
  writing = run.catch(() => {});
  return run;
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

/** Words in a key that make its value personal in a server's JSON (an audit event's details, say). */
const PERSONAL_WORDS = new Set([
  "user", "username", "users", "name", "email", "mail", "address", "addr", "ip", "ips", "ipv4", "ipv6", "host", "hostname",
  "login", "account", "player", "players", "steam", "steamid", "client", "remote", "origin", "endpoint", "person", "principal",
]);

/** A key's words: camelCase, snake_case, kebab-case and dots split ("remoteIpAddress" → remote, ip, address). */
export function personalKey(key: string): boolean {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[\s_.\-]+/);
  return words.some((w) => PERSONAL_WORDS.has(w.toLowerCase()));
}

/**
 * Pretty JSON with personal values dotted out while details are hidden: values under keys that
 * name a person or an address, and IPs anywhere. Text that isn't JSON gets its IPs hidden.
 */
export function privJson(text: string): string {
  if (!hideDetails()) return text;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return privIps(text);
  }
  const walk = (v: unknown, personal: boolean): unknown => {
    if (typeof v === "string") return personal ? masked(v) : privIps(v);
    if (typeof v === "number" && personal) return masked(String(v));
    if (Array.isArray(v)) return v.map((x) => walk(x, personal));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, personal || personalKey(k))]));
    return v;
  };
  return JSON.stringify(walk(value, false), null, 2);
}

/** A personal detail on its own line or chip: its stand-in is also blurred while hidden. */
export function Private(props: { text: string | null | undefined; class?: string; testID?: string }) {
  return (
    <Text testID={props.testID} class={`${props.class ?? ""} ${hideDetails() ? "blur-[3px]" : ""}`} accessibilityLabel={hideDetails() ? "Hidden" : undefined}>
      {priv(props.text)}
    </Text>
  );
}

/** A run of hidden characters, with the separators inside it (an address, a full name, an email). */
const HIDDEN_RUN = /•(?:[•.:@\-_/]|\s(?=•))*/g;

/**
 * A line that may hold hidden details among plain words ("•••.•.•.• · active 1 min ago"): while
 * details are hidden, each hidden run is blurred on its own and the rest stays sharp, as the
 * web panel does. Shown as one plain text otherwise. `box` lays out the line (flex-1, a width);
 * `class` styles the text.
 */
export function PrivText(props: { text: string | null | undefined; class?: string; box?: string; testID?: string }) {
  const parts = () => {
    const text = props.text ?? "";
    if (!hideDetails() || !text.includes("•")) return null;
    const out: { text: string; hidden: boolean }[] = [];
    let at = 0;
    for (const m of text.matchAll(HIDDEN_RUN)) {
      if (m.index! > at) out.push({ text: text.slice(at, m.index), hidden: false });
      out.push({ text: m[0], hidden: true });
      at = m.index! + m[0].length;
    }
    if (at < text.length) out.push({ text: text.slice(at), hidden: false });
    return out;
  };
  return (
    <If when={parts()} else={<Text testID={props.testID} class={`${props.box ?? ""} ${props.class ?? ""}`}>{props.text ?? ""}</Text>}>
      {(list) => (
        <View testID={props.testID} accessibilityLabel="Partly hidden" class={`flex-row flex-wrap items-center ${props.box ?? ""}`}>
          <Each of={list()}>
            {(part) => <Text class={`shrink ${props.class ?? ""} ${part().hidden ? "blur-[3px]" : ""}`}>{part().text}</Text>}
          </Each>
        </View>
      )}
    </If>
  );
}
