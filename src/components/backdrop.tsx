import { context, Image, type JSX, Scroll, View, windowSize } from "nsh";
import backdrop from "../../assets/backdrop.webp";
import backdropPortrait from "../../assets/backdrop-portrait.webp";

/**
 * The artwork for this window. Drawn to cover, a portrait phone only ever shows a centre slice
 * of the wide original (2000×1125), so phones get that slice alone (640×1125, a third of the
 * memory); wider windows (tablets, landscape, desktops) get the whole picture.
 */
const art = () => {
  const { width, height } = windowSize();
  return height > 0 && width / height <= 640 / 1125 ? backdropPortrait : backdrop;
};

/**
 * How far the page around a component is from the top of the navigation stack: 0 for the
 * page showing, 1 for the one under it. Pages further down stay alive (so back returns to
 * them as they were) but can't be seen, so they don't hold the artwork.
 */
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
      {/* The page showing and the one under it (seen while swiping back) draw the artwork; a
          decoded copy and its texture are several MB, so deeper pages let theirs go. */}
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
