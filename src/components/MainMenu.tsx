import { Image, type ImageAsset, signal, Text, View } from "nsh";
import { Popover } from "nsh/base";
import access from "../../assets/menu/access.svg";
import activity from "../../assets/menu/activity.svg";
import analytics from "../../assets/menu/analytics.svg";
import menu from "../../assets/menu/menu.svg";
import networking from "../../assets/menu/networking.svg";
import overview from "../../assets/menu/overview.svg";
import settings from "../../assets/menu/settings.svg";
import shards from "../../assets/menu/shards.svg";
import spires from "../../assets/menu/spires.svg";
import { nav, type Route } from "../state/nav";

export type MenuSection = "overview" | "shards" | "spires" | "networking" | "analytics" | "activity" | "access" | "settings";

interface Entry {
  id: MenuSection;
  label: string;
  icon: ImageAsset;
  /** The page it opens; none yet for sections the app doesn't have. */
  route?: (serverId: string) => Route;
}

/** The panel's Main Menu, in its order. */
const ENTRIES: Entry[] = [
  { id: "overview", label: "Overview", icon: overview, route: (serverId) => ({ name: "overview", serverId }) },
  { id: "shards", label: "Shards", icon: shards, route: (serverId) => ({ name: "shards", serverId }) },
  { id: "spires", label: "Spires", icon: spires, route: (serverId) => ({ name: "spires", serverId }) },
  { id: "networking", label: "Networking", icon: networking, route: (serverId) => ({ name: "networking", serverId }) },
  { id: "analytics", label: "Analytics", icon: analytics, route: (serverId) => ({ name: "analytics", serverId }) },
  { id: "activity", label: "Activity", icon: activity, route: (serverId) => ({ name: "activity", serverId }) },
  { id: "access", label: "Access", icon: access, route: (serverId) => ({ name: "access", serverId }) },
  { id: "settings", label: "Settings", icon: settings, route: (serverId) => ({ name: "settings", serverId }) },
];

const ACCENT = "#38bdf8"; // sky-400, the panel's highlight
const MUTED = "#a1a1b5";
const BRIGHT = "#f4f4f8";

/**
 * Goes to a section of one server: back to that server's instance list (keeping the
 * stack under it), then on to the section's page when it isn't the list itself.
 */
export function goTo(serverId: string, route: Route) {
  const routes = nav.routes();
  const at = routes.findIndex((r) => r.name === "shards" && r.serverId === serverId);
  const base = at >= 0 ? routes.slice(0, at + 1) : [{ name: "servers" } as Route, { name: "shards", serverId } as Route];
  nav.setRoutes(route.name === "shards" ? base : [...base, route]);
}

/**
 * The ☰ button in the top bar and the panel-style Main Menu it opens: the panel's
 * sections with line icons, the current one marked with a bar on its left.
 */
export function MainMenu(props: { serverId: string; current: MenuSection }) {
  const open = signal(false);

  const pick = (entry: Entry) => {
    if (!entry.route) return;
    open.set(false);
    if (entry.id !== props.current) goTo(props.serverId, entry.route(props.serverId));
  };

  return (
    <Popover
      open={open()}
      onOpenChange={(e) => open.set(e.open)}
      placement="bottom"
      align="end"
      offset={8}
      margin={12}
      popupClass="w-60 overflow-hidden rounded-2xl border border-white/10 bg-popover pt-3 pb-2 shadow-2xl backdrop-blur-xl transition-all duration-150 ease-out"
      popupStartingClass="opacity-0 scale-95 -translate-y-1"
      popupEndingClass="opacity-0 scale-95 -translate-y-1"
      trigger={
        <View
          role="button"
          accessibilityLabel="Main menu"
          testID="main-menu"
          class={`h-10 w-10 items-center justify-center rounded-full ${open() ? "bg-primary/30" : "bg-primary/15"} active:bg-primary/30`}
        >
          <Image src={menu} style={{ width: 22, height: 22, tintColor: "#a78bfa" }} />
        </View>
      }
    >
      <View>
        <Text class="px-4 pb-2 text-sm text-muted-foreground">Main Menu</Text>
        <Each of={ENTRIES} key={(e: Entry) => e.id}>
          {(entry) => {
            const selected = () => entry().id === props.current;
            const available = () => !!entry().route;
            return (
              <View
                role="menuitem"
                testID={`nav-${entry().id}`}
                accessibilityLabel={available() ? entry().label : `${entry().label}, not in the app yet`}
                onPress={() => pick(entry())}
                class={`flex-row items-center gap-3.5 py-3 pr-4 pl-4 ${selected() ? "bg-sky-400/10" : available() ? "active:bg-white/5" : ""}`}
              >
                <If when={selected()}>
                  <View class="absolute top-0 bottom-0 left-0 w-[3px] bg-sky-400" />
                </If>
                <Image
                  src={entry().icon}
                  style={{ width: 22, height: 22, tintColor: selected() ? ACCENT : available() ? BRIGHT : MUTED, opacity: available() ? 1 : 0.45 }}
                />
                <Text
                  class={`flex-1 text-[15px] font-semibold ${
                    selected() ? "text-white" : available() ? "text-foreground" : "text-muted-foreground/60"
                  }`}
                >
                  {entry().label}
                </Text>
                <If when={!available()}>
                  <Text class="text-[10px] font-semibold tracking-wider text-muted-foreground/60">SOON</Text>
                </If>
              </View>
            );
          }}
        </Each>
      </View>
    </Popover>
  );
}
