import { Image, type JSX, Scroll, View } from "nsh";
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
          props.dim === "strong"
            ? "bg-linear-to-b from-background/70 via-background/85 to-background"
            : "bg-linear-to-b from-background/10 via-background/40 to-background"
        }`}
      />
    </View>
  );
}

/** A screen's body: the artwork fixed behind, the content scrolling over it. */
export function Screen(props: { children?: JSX.Element; refreshing?: boolean; onRefresh?: () => void }) {
  return (
    <View class="flex-1 bg-background">
      <Backdrop dim="strong" />
      <Scroll class="flex-1" refreshing={props.refreshing} onRefresh={props.onRefresh}>
        {props.children}
      </Scroll>
    </View>
  );
}
