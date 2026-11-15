import { effect, Image, signal, Text, View } from "nsh";
import { avatarUrl } from "../api/analytics";
import type { AmpClient } from "../api/client";
import { hideDetails, priv } from "../lib/privacy";

/** Avatars already fetched this run, by hash, so a refresh doesn't fetch them again. */
const cache = new Map<string, Promise<string | null>>();

const TINTS = ["bg-violet-500/30", "bg-sky-500/30", "bg-emerald-500/30", "bg-pink-500/30", "bg-amber-500/30"];

/**
 * A player's picture: their Steam avatar (through the panel) when they have one, otherwise
 * their initial on a tinted circle.
 */
export function Avatar(props: { client: AmpClient | null; hash?: string | null; name: string; size?: "sm" | "lg" }) {
  const src = signal<string | null>(null);
  effect(() => {
    const hash = props.hash;
    const client = props.client;
    src.set(null);
    if (!hash || !client) return;
    let promise = cache.get(hash);
    if (!promise) {
      promise = avatarUrl(client, hash);
      cache.set(hash, promise);
    }
    promise.then((url) => {
      if (props.hash === hash) src.set(url);
    });
  });
  const box = () => (props.size === "lg" ? "h-16 w-16" : "h-9 w-9");
  const initial = () => (props.name.trim()[0] ?? "?").toUpperCase();
  const tint = () => TINTS[[...props.name].reduce((a, c) => a + c.charCodeAt(0), 0) % TINTS.length];
  return (
    <View class={`${box()} items-center justify-center overflow-hidden rounded-full ${tint()}`}>
      {/* Hidden details: no picture and no initial. */}
      <If when={hideDetails() ? null : src()} else={<Text class={`font-bold text-white ${props.size === "lg" ? "text-2xl" : "text-sm"} ${hideDetails() ? "blur-[3px]" : ""}`}>{hideDetails() ? "•" : initial()}</Text>}>
        {(url) => <Image src={url()} accessibilityLabel={props.name} class="h-full w-full object-cover" />}
      </If>
    </View>
  );
}
