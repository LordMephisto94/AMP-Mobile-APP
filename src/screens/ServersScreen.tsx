import { Image, Scroll, Text, View } from "nsh";
import { AlertDialog, NavPage } from "nsh/base";
import wordmark from "../../assets/amp-wordmark.webp";
import { AmpBanner } from "../components/AmpBanner";
import { Backdrop } from "../components/backdrop";
import { PrimaryButton } from "../components/ui";
import { nav } from "../state/nav";
import { isSignedIn, removeServer, servers, type SavedServer, signOutServer } from "../state/servers";

/** Home: the saved AMP servers and the button to add one. */
export function ServersScreen() {
  return (
    <NavPage title="Servers" headerVisible={false}>
      <View class="flex-1 bg-background">
        <Backdrop />
        <Scroll class="flex-1">
          <View class="items-center gap-3 px-6 pt-[calc(env(safe-area-inset-top)+56px)] pb-8">
            <Image src={wordmark} accessibilityLabel="AMP, Application Management Panel" class="h-20 w-64 object-contain" />
            <Text class="text-sm font-semibold tracking-widest text-glow">MOBILE</Text>
          </View>

          <View class="gap-3 px-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
            <View class="flex-row items-baseline justify-between px-1">
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

            <Each of={servers()} key={(s: SavedServer) => s.id}>
              {(server) => <ServerCard server={server()} />}
            </Each>

            <View class="mt-2">
              <PrimaryButton title="Add Server" icon="＋" onPress={() => nav.push({ name: "addServer" })} />
            </View>
          </View>
        </Scroll>
      </View>
    </NavPage>
  );
}

/** A saved server, drawn as the AMP panel draws its header. */
function ServerCard(props: { server: SavedServer }) {
  const signedIn = () => isSignedIn(props.server);

  const open = () =>
    nav.push(signedIn() ? { name: "shards", serverId: props.server.id } : { name: "signIn", serverId: props.server.id });

  const menu = async () => {
    const { action } = await AlertDialog.show({
      title: props.server.name,
      presentation: "actionSheet",
      actions: [
        ...(signedIn() ? [{ id: "signOut", label: "Sign out" }] : [{ id: "signIn", label: "Sign in" }]),
        { id: "remove", label: "Remove server", role: "destructive" as const },
        { id: "cancel", label: "Cancel", role: "cancel" as const },
      ],
    });
    if (action === "signOut") await signOutServer(props.server.id);
    else if (action === "signIn") nav.push({ name: "signIn", serverId: props.server.id });
    else if (action === "remove") await removeServer(props.server.id);
  };

  return (
    <View
      role="button"
      testID={`server-${props.server.name}`}
      onPress={open}
      onLongPress={menu}
      class="overflow-hidden rounded-(--radius) border border-white/10 shadow-lg active:opacity-85"
    >
      <AmpBanner
        title={props.server.name}
        status={signedIn() ? "online" : "offline"}
        statusLabel={signedIn() ? "Signed in" : "Signed out"}
        subtitle={`${props.server.username} · ${props.server.serverUrl.replace(/^https?:\/\//, "")}`}
      />
      <Text onPress={menu} class="absolute top-3 right-4 text-xl text-white/80">
        ⋯
      </Text>
    </View>
  );
}
