import { shownAddress } from "../state/prefs";
import { Image, Scroll, signal, Text, View } from "nsh";
import { NavPage } from "nsh/base";
import wordmark from "../../assets/amp-wordmark.webp";
import app from "../../nsh.json";
import { type BannerStatus, StatusBadge } from "../components/AmpBanner";
import { Backdrop } from "../components/backdrop";
import { inkTint } from "../components/Icon";
import { confirm } from "../components/Confirm";
import { Dropdown, type DropdownItem, MoreButton } from "../components/Dropdown";
import { PrimaryButton } from "../components/ui";
import { poll } from "../lib/poll";
import { nav } from "../state/nav";
import { checkServers, reachOf } from "../state/reachability";
import { isSignedIn, locked, moveServer, removeServer, servers, type SavedServer, signOutServer } from "../state/servers";

/** The About dialog: what this app is, and that it is not official. */
export function showAbout() {
  confirm({
    title: `AMP Mobile ${app.version}`,
    message:
      "An unofficial, independent mobile app for managing AMP 3 servers. It is not made, endorsed or supported by " +
      "CubeCoders Limited. AMP, the AMP logo and Application Management Panel are theirs.\n\n" +
      "The app talks only to the servers you add, using AMP's own API. For help with AMP itself, see cubecoders.com.",
    cancelLabel: null,
    actions: [{ id: "ok", label: "OK", tone: "primary" }],
  });
}

/** Home: the saved AMP servers and the button to add one. */
export function ServersScreen() {
  // Whether each panel answers: checked when the page shows and every minute while it does.
  // Reading the list inside also checks a server as soon as it's added or edited. Nothing
  // is asked of any server while the app is locked.
  poll(() => checkServers(servers()), 60_000, () => !locked() && nav.routes().at(-1)?.name === "servers");

  return (
    <NavPage title="Servers" headerVisible={false}>
      <View class="flex-1 bg-background">
        <Backdrop />
        <Scroll class="flex-1">
          <View class="items-center gap-3 px-6 pt-[calc(env(safe-area-inset-top)+56px)] pb-8">
            <Image src={wordmark} accessibilityLabel="AMP, Application Management Panel" style={inkTint()} class="h-20 w-64 object-contain" />
            <Text class="text-sm font-semibold text-series">Mobile</Text>
          </View>

          <View class="w-full max-w-5xl gap-3 self-center px-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
            <View class="flex-row items-baseline justify-between px-1 md:justify-center md:gap-3">
              <Text class="text-xl font-bold text-foreground">Your servers</Text>
              <If when={servers().length > 0}>
                <Text class="text-sm text-foreground/80">{`${servers().length} saved`}</Text>
              </If>
            </View>

            <If when={servers().length === 0}>
              <View class="items-center gap-2 rounded-(--radius) border border-dashed border-input bg-card px-6 py-10">
                <Text class="text-lg font-semibold text-card-foreground">No servers yet</Text>
                <Text class="text-center text-sm text-muted-foreground">
                  Add your publicly reachable AMP 3 server with its address and your panel login.
                </Text>
              </View>
            </If>

            <View class="gap-3 md:flex-row md:flex-wrap md:justify-center">
              <Each of={servers()} key={(s: SavedServer) => s.id}>
                {(server) => (
                  <View class="md:w-[49%]">
                    <ServerCard server={server()} />
                  </View>
                )}
              </Each>
            </View>

            <View class="mt-2 w-full self-center md:max-w-md">
              <PrimaryButton title="Add Server" onPress={() => nav.push({ name: "addServer" })} />
            </View>

            <View class="mt-8 items-center gap-2 px-6">
              <Text class="text-center text-xs leading-4 text-muted-foreground">
                Unofficial app. Not made by or affiliated with CubeCoders, the makers of AMP.
              </Text>
              <View class="flex-row gap-2">
                <View
                  role="button"
                  testID="app-settings"
                  onPress={() => nav.push({ name: "appSettings" })}
                  class="rounded-(--radius) border border-input px-3.5 py-1.5 active:bg-accent"
                >
                  <Text class="text-xs font-semibold text-muted-foreground">Settings</Text>
                </View>
                <View
                  role="button"
                  testID="about"
                  onPress={showAbout}
                  class="rounded-(--radius) border border-input px-3.5 py-1.5 active:bg-accent"
                >
                  <Text class="text-xs font-semibold text-muted-foreground">About</Text>
                </View>
              </View>
            </View>
          </View>
        </Scroll>
      </View>
    </NavPage>
  );
}

/** A saved server, drawn as the AMP panel draws its header, with its own dropdown menu. */
function ServerCard(props: { server: SavedServer }) {
  const signedIn = () => isSignedIn(props.server);
  const menuOpen = signal(false);

  const open = () =>
    nav.push(signedIn() ? { name: "shards", serverId: props.server.id } : { name: "signIn", serverId: props.server.id });

  const remove = async () => {
    const choice = await confirm({
      title: `Remove ${props.server.name}?`,
      message: "It's removed from this phone and signed out. Nothing on the server changes; you can add it again any time.",
      tone: "danger",
      actions: [{ id: "remove", label: "Remove", tone: "danger" }],
    });
    if (choice === "remove") await removeServer(props.server.id);
  };

  const items = (): DropdownItem[] => [
    { id: "open", label: signedIn() ? "Open instances" : "Sign in", onSelect: open },
    { id: "up", label: "Move up", disabled: servers()[0]?.id === props.server.id, onSelect: () => moveServer(props.server.id, -1) },
    { id: "down", label: "Move down", disabled: servers().at(-1)?.id === props.server.id, onSelect: () => moveServer(props.server.id, 1) },
    ...(signedIn()
      ? [{ id: "signOut", label: "Sign out", onSelect: () => signOutServer(props.server.id) }]
      : []),
    { id: "remove", label: "Remove server", tone: "danger" as const, onSelect: remove },
  ];

  const reach = () => reachOf(props.server);
  const reachStatus: Record<ReturnType<typeof reachOf>, BannerStatus> = { checking: "offline", online: "online", offline: "danger" };
  return (
    <View
      role="button"
      testID={`server-${props.server.name}`}
      onPress={open}
      onLongPress={() => menuOpen.set(true)}
      class="gap-3 rounded-(--radius) border border-border bg-card p-4 active:opacity-85 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <View class="flex-row items-start gap-3">
        <View class="flex-1 gap-0.5">
          <Text class="line-clamp-1 text-lg font-semibold text-card-foreground">{props.server.name}</Text>
          <Text class="line-clamp-1 text-sm text-muted-foreground">{`${props.server.username} · ${shownAddress(props.server.serverUrl.replace(/^https:\/\//, ""))}`}</Text>
        </View>
        <Dropdown
          open={menuOpen()}
          onOpenChange={(o) => menuOpen.set(o)}
          title={props.server.name}
          items={items()}
          trigger={<MoreButton testID={`more-${props.server.name}`} />}
        />
      </View>
      <View class="flex-row flex-wrap gap-2">
        <StatusBadge label={signedIn() ? "Signed in" : "Signed out"} status={signedIn() ? "online" : "offline"} />
        <StatusBadge
          label={{ checking: "Checking…", online: "Online", offline: "Offline" }[reach()]}
          status={reachStatus[reach()]}
          testID={`reach-${props.server.name}`}
        />
      </View>
    </View>
  );
}
