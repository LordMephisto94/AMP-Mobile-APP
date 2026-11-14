import { mount, Text, View } from "nsh";
import { NavStack } from "nsh/base";
import { ConfirmHost } from "./src/components/Confirm";
import { AccessScreen } from "./src/screens/AccessScreen";
import { ActivityScreen } from "./src/screens/ActivityScreen";
import { AnalyticsScreen } from "./src/screens/AnalyticsScreen";
import { ConsoleScreen } from "./src/screens/ConsoleScreen";
import { CreateShardScreen } from "./src/screens/CreateShardScreen";
import { FileEditScreen } from "./src/screens/FileEditScreen";
import { FilesScreen } from "./src/screens/FilesScreen";
import { InviteScreen } from "./src/screens/InviteScreen";
import { NetworkingScreen } from "./src/screens/NetworkingScreen";
import { OverviewScreen } from "./src/screens/OverviewScreen";
import { PlayerScreen } from "./src/screens/PlayerScreen";
import { ServerFormScreen } from "./src/screens/ServerFormScreen";
import { ServersScreen } from "./src/screens/ServersScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { ShardScreen } from "./src/screens/ShardScreen";
import { ShardSettingsScreen } from "./src/screens/ShardSettingsScreen";
import { ShardsScreen } from "./src/screens/ShardsScreen";
import { SpireScreen } from "./src/screens/SpireScreen";
import { SpiresScreen } from "./src/screens/SpiresScreen";
import { UserScreen } from "./src/screens/UserScreen";
import { nav, type Route } from "./src/state/nav";
import { loadServers, serversReady } from "./src/state/servers";

function screen(route: Route) {
  switch (route.name) {
    case "servers":
      return <ServersScreen />;
    case "addServer":
      return <ServerFormScreen />;
    case "signIn":
      return <ServerFormScreen serverId={route.serverId} />;
    case "shards":
      return <ShardsScreen serverId={route.serverId} />;
    case "shard":
      return <ShardScreen serverId={route.serverId} id={route.id} title={route.title} image={route.image} />;
    case "console":
      return <ConsoleScreen serverId={route.serverId} id={route.id} title={route.title} tenantId={route.tenantId} />;
    case "createShard":
      return <CreateShardScreen serverId={route.serverId} />;
    case "shardSettings":
      return <ShardSettingsScreen serverId={route.serverId} id={route.id} title={route.title} />;
    case "files":
      return <FilesScreen serverId={route.serverId} id={route.id} title={route.title} path={route.path} />;
    case "analytics":
      return <AnalyticsScreen serverId={route.serverId} shardId={route.shardId} title={route.title} />;
    case "player":
      return <PlayerScreen serverId={route.serverId} userKey={route.userKey} name={route.playerName} shardId={route.shardId} />;
    case "overview":
      return <OverviewScreen serverId={route.serverId} />;
    case "spires":
      return <SpiresScreen serverId={route.serverId} />;
    case "spire":
      return <SpireScreen serverId={route.serverId} id={route.id} title={route.title} />;
    case "networking":
      return <NetworkingScreen serverId={route.serverId} />;
    case "access":
      return <AccessScreen serverId={route.serverId} tab={route.tab} />;
    case "user":
      return <UserScreen serverId={route.serverId} userId={route.userId} />;
    case "invite":
      return <InviteScreen serverId={route.serverId} />;
    case "settings":
      return <SettingsScreen serverId={route.serverId} />;
    case "activity":
      return <ActivityScreen serverId={route.serverId} />;
    case "fileEdit":
      return <FileEditScreen serverId={route.serverId} id={route.id} path={route.path} managed={route.managed} />;
  }
}

function App() {
  return (
    <View class="flex-1 bg-background">
      <If
        when={serversReady()}
        else={
          <View class="flex-1 items-center justify-center">
            <Text class="text-muted-foreground">Loading…</Text>
          </View>
        }
      >
        <NavStack state={nav} class="flex-1">
          {(route) => screen(route)}
        </NavStack>
      </If>
      <ConfirmHost />
    </View>
  );
}

loadServers();
mount(App);
