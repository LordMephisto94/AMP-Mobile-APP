import { context, Image, type JSX, Scroll, View, windowSize } from "nsh";
import backdrop from "../../assets/backdrop.webp";
import backdropPortrait from "../../assets/backdrop-portrait.webp";

/** A portrait phone only shows a centre slice of the art, so it gets that slice: a third of the memory. */
const art = () => {
  const { width, height } = windowSize();
  return height > 0 && width / height <= 640 / 1125 ? backdropPortrait : backdrop;
};

/** A page's distance from the top of the stack: 0 showing, 1 under it (seen while swiping back). */
export const PageDepth = context<() => number>(() => 0);

/** The depth of the page being built right now (set by the stack's render function). */
let building: () => number = () => 0;

/** Builds a page knowing its depth; the page's root component reads it with `pageDepthHere`. */
export function withPageDepth<T>(depth: () => number, build: () => T): T {
  const before = building;
  building = depth;
  try {
    return build();
  } finally {
    building = before;
  }
}

/** The depth of the page under construction: read once, by a page's root component. */
export function pageDepthHere(): () => number {
  return building;
}

/**
 * The app's artwork (neon ribbons over black) filling its parent, behind everything
 * else. `dim` darkens it so text on top stays readable.
 */
export function Backdrop(props: { dim?: "light" | "strong" }) {
  const depth = PageDepth();
  return (
    <View class="absolute inset-0">
      {/* Hidden pages deeper down let their copy go: each is several MB decoded. */}
      <If when={depth() <= 1}>
        <Image testID="backdrop-art" src={art()} class="absolute inset-0 h-full w-full object-cover" />
      </If>
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
