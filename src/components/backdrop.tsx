import { colorScheme, Image, type JSX, Scroll, View } from "nsh";
import backdrop from "../../assets/backdrop.webp";

/**
 * The app's artwork (neon ribbons over black) filling its parent, behind everything
 * else. `dim` darkens it so text on top stays readable.
 */
export function Backdrop(props: { dim?: "light" | "strong" }) {
  return (
    <View class="absolute inset-0">
      <Image src={backdrop} class="absolute inset-0 h-full w-full object-cover" />
      <View
        class={`absolute inset-0 ${
          colorScheme() === "light"
            ? "bg-linear-to-b from-background/88 via-background/92 to-background"
            : props.dim === "strong"
              ? "bg-linear-to-b from-background/70 via-background/85 to-background"
              : "bg-linear-to-b from-background/10 via-background/40 to-background"
        }`}
      />
    </View>
  );
}

/** A screen's body: the content scrolling over a plain background. `art` puts the artwork behind it (the home screen only). */
export function Screen(props: { children?: JSX.Element; refreshing?: boolean; onRefresh?: () => void; art?: boolean }) {
  return (
    <View class="flex-1 bg-background">
      <If when={props.art}>
        <Backdrop dim="strong" />
      </If>
      <Scroll class="flex-1" refreshing={props.refreshing} onRefresh={props.onRefresh}>
        {props.children}
      </Scroll>
    </View>
  );
}
