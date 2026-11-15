import { Image, Scroll, signal, Text, View } from "nsh";
import { NavPage } from "nsh/base";
import wordmark from "../../assets/amp-wordmark.webp";
import app from "../../nsh.json";
import { AmpBanner } from "../components/AmpBanner";
import { Backdrop } from "../components/backdrop";
import { confirm } from "../components/Confirm";
import { Dropdown, type DropdownItem, MoreButton } from "../components/Dropdown";
import { PrimaryButton } from "../components/ui";
import { poll } from "../lib/poll";
import { nav } from "../state/nav";
import { checkServers, reachOf } from "../state/reachability";
import { isSignedIn, locked, removeServer, servers, type SavedServer, signOutServer } from "../state/servers";
import { priv } from "../lib/privacy";
import { isPlainHttp, plainHttpRisk } from "../api/client";

/** The About dialog: what this app is, and that it is not official. */
function showAbout() {
  confirm({
    title: `AMP Mobile ${app.version}`,
    icon: "ℹ️",
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
            <Image src={wordmark} accessibilityLabel="AMP, Application Management Panel" class="h-20 w-64 object-contain" />
            <Text class="text-sm font-semibold tracking-widest text-glow">MOBILE</Text>
          </View>

          <View class="w-full max-w-5xl gap-3 self-center px-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
            <View class="flex-row items-baseline justify-between px-1 md:justify-center md:gap-3">
              <Text class="text-xl font-bold text-foreground">Your servers</Text>
              <If when={servers().length > 0}>
                <Text class="text-sm text-muted-foreground">{`${servers().length} saved`}</Text>
              </If>
            </View>

            <If when={servers().length === 0}>
              <View class="items-center gap-2 rounded-(--radius) border border-dashed border-input bg-card/80 px-6 py-10">
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
              <PrimaryButton title="Add Server" icon="＋" onPress={() => nav.push({ name: "addServer" })} />
            </View>

            <View class="mt-8 items-center gap-2 px-6">
              <Text class="text-center text-xs leading-4 text-muted-foreground">
                Unofficial app. Not made by or affiliated with CubeCoders, the makers of AMP.
              </Text>
              <View class="flex-row gap-2">
                <View
                  role="button"
                  testID="security"
                  onPress={() => nav.push({ name: "security" })}
                  class="flex-row items-center gap-1.5 rounded-full border border-white/10 bg-card/60 px-3.5 py-1.5 active:bg-accent"
                >
                  <Text class="text-xs text-muted-foreground">🔒</Text>
                  <Text class="text-xs font-semibold text-muted-foreground">Security</Text>
                </View>
                <View
                  role="button"
                  testID="about"
                  onPress={showAbout}
                  class="flex-row items-center gap-1.5 rounded-full border border-white/10 bg-card/60 px-3.5 py-1.5 active:bg-accent"
                >
                  <Text class="text-xs text-muted-foreground">ⓘ</Text>
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
      icon: "🗑️",
      tone: "danger",
      actions: [{ id: "remove", label: "Remove", tone: "danger" }],
    });
    if (choice === "remove") await removeServer(props.server.id);
  };

  const items = (): DropdownItem[] => [
    { id: "open", label: signedIn() ? "Open instances" : "Sign in", icon: signedIn() ? "🎮" : "🔑", onSelect: open },
    ...(signedIn()
      ? [{ id: "signOut", label: "Sign out", icon: "🚪", onSelect: () => signOutServer(props.server.id) }]
      : []),
    { id: "remove", label: "Remove server", icon: "🗑️", tone: "danger" as const, onSelect: remove },
  ];

  return (
    <View
      role="button"
      testID={`server-${props.server.name}`}
      onPress={open}
      onLongPress={() => menuOpen.set(true)}
      class="overflow-hidden rounded-(--radius) border border-white/10 shadow-lg active:opacity-85"
    >
      <AmpBanner
        title={props.server.name}
        status={signedIn() ? "online" : "offline"}
        statusLabel={signedIn() ? "Signed in" : "Signed out"}
        extraBadge={[
          {
            label: { checking: "Checking…", online: "Online", offline: "Offline" }[reachOf(props.server)],
            status: ({ checking: "offline", online: "online", offline: "danger" } as const)[reachOf(props.server)],
            testID: `reach-${props.server.name}`,
          },
          // Plain HTTP outside Tailscale: the login crosses a network unencrypted.
          ...(plainHttpRisk(props.server.serverUrl) ? [{ label: "Not secure", status: "danger" as const, testID: `insecure-${props.server.name}` }] : []),
        ]}
        subtitle={`${priv(props.server.username)} · ${priv(props.server.serverUrl.replace(/^https?:\/\//, ""))}${
          isPlainHttp(props.server.serverUrl) && !plainHttpRisk(props.server.serverUrl) ? " · HTTP over Tailscale" : ""
        }`}
      />
      <View class="absolute top-3 right-3">
        <Dropdown
          open={menuOpen()}
          onOpenChange={(o) => menuOpen.set(o)}
          title={props.server.name}
          items={items()}
          trigger={<MoreButton testID={`more-${props.server.name}`} />}
        />
      </View>
    </View>
  );
}
