import { mount, Text, View } from "nsh";
import { NavStack } from "nsh/base";
import { ConfirmHost } from "./src/components/Confirm";
import { LockHost } from "./src/components/Lock";
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
import { RoleScreen } from "./src/screens/RoleScreen";
import { ServerFormScreen } from "./src/screens/ServerFormScreen";
import { SecurityScreen } from "./src/screens/SecurityScreen";
import { ServersScreen } from "./src/screens/ServersScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { ShardScreen } from "./src/screens/ShardScreen";
import { ShardSettingsScreen } from "./src/screens/ShardSettingsScreen";
import { ScheduleEditScreen, ScheduleRunsScreen, SchedulesScreen } from "./src/screens/SchedulesScreen";
import { SnapshotsScreen } from "./src/screens/SnapshotsScreen";
import { ShardsScreen } from "./src/screens/ShardsScreen";
import { SpireScreen } from "./src/screens/SpireScreen";
import { SpiresScreen } from "./src/screens/SpiresScreen";
import { UserScreen } from "./src/screens/UserScreen";
import { nav, type Route } from "./src/state/nav";
import { loadServers, locked, serversReady } from "./src/state/servers";

function screen(route: Route) {
  switch (route.name) {
    case "servers":
      return <ServersScreen />;
    case "security":
      return <SecurityScreen />;
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
    case "snapshots":
      return <SnapshotsScreen serverId={route.serverId} id={route.id} title={route.title} />;
    case "schedules":
      return <SchedulesScreen serverId={route.serverId} id={route.id} title={route.title} />;
    case "scheduleEdit":
      return <ScheduleEditScreen serverId={route.serverId} id={route.id} title={route.title} scheduleId={route.scheduleId} />;
    case "scheduleRuns":
      return <ScheduleRunsScreen serverId={route.serverId} id={route.id} scheduleId={route.scheduleId} scheduleName={route.scheduleName} />;
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
    case "role":
      return <RoleScreen serverId={route.serverId} roleId={route.roleId} />;
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
      {/* Locked, nothing of the app is rendered (not just covered): the stack's routes live
          in `nav`, so it comes back where it was. */}
      <If
        when={serversReady() && !locked()}
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
      <LockHost />
      <ConfirmHost />
    </View>
  );
}

loadServers();
mount(App);
