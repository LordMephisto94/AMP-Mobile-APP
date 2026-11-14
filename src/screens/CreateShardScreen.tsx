import { Image, Scroll, signal, Text, View } from "nsh";
import { Input } from "nsh/base";
import { artworkUrl } from "../api/artwork";
import { AmpError } from "../api/client";
import { type AppSpec, createShard, listSpires, listTemplates, placeableSpires, type SpireDefinition } from "../api/manage";
import { Backdrop } from "../components/backdrop";
import { Select } from "../components/Dropdown";
import { AppPage, Checkbox, ErrorText, Field, PrimaryButton } from "../components/ui";
import { nav } from "../state/nav";
import { clearServerSession, clientFor, serverById } from "../state/servers";

/** Create an instance: choose a game from the server's catalogue, then name and place it. */
export function CreateShardScreen(props: { serverId: string }) {
  const serverUrl = serverById(props.serverId)?.serverUrl ?? "";
  const templates = signal<AppSpec[] | null>(null);
  const spires = signal<SpireDefinition[]>([]);
  const error = signal<string | null>(null);
  const search = signal("");
  const chosen = signal<AppSpec | null>(null);

  const name = signal("");
  const description = signal("");
  const spireId = signal<string | null>(null);
  const startNow = signal(true);
  const startOnBoot = signal(false);
  const creating = signal(false);

  const fail = async (e: unknown) => {
    if (e instanceof AmpError && e.isUnauthorized) {
      await clearServerSession(props.serverId);
      nav.setRoutes([{ name: "servers" }, { name: "signIn", serverId: props.serverId }]);
    } else if (e instanceof AmpError && e.status === 403) {
      error.set("Your account isn't allowed to create instances on this server.");
    } else if (e instanceof AmpError && e.status === 409) {
      error.set("The server's app catalogue hasn't synced yet. Try again in a minute.");
    } else {
      error.set((e as Error).message);
    }
  };

  (async () => {
    try {
      const client = clientFor(props.serverId);
      const [t, s] = await Promise.all([listTemplates(client), listSpires(client).catch(() => [])]);
      templates.set(
        t
          .filter((x) => !x.metadata?.deprecatedReason)
          .sort((a, b) => title(a).localeCompare(title(b))),
      );
      const usable = placeableSpires(s);
      spires.set(usable);
      spireId.set((usable.find((x) => x.isLocal) ?? usable[0])?.id ?? null);
    } catch (e) {
      await fail(e);
    }
  })();

  const shown = () => {
    const q = search().trim().toLowerCase();
    const all = templates() ?? [];
    if (!q) return all;
    return all.filter((t) => `${title(t)} ${t.templateSlug} ${t.metadata?.description ?? ""}`.toLowerCase().includes(q));
  };

  const choose = (t: AppSpec) => {
    chosen.set(t);
    name.set(title(t));
    error.set(null);
  };

  const create = async () => {
    const template = chosen();
    if (!template || creating()) return;
    if (!name().trim()) {
      error.set("Give the instance a name");
      return;
    }
    creating.set(true);
    error.set(null);
    try {
      const result = await createShard(clientFor(props.serverId), {
        templateSlug: template.templateSlug,
        displayName: name().trim(),
        description: description().trim(),
        spireId: spireId(),
        startNow: startNow(),
        startOnBoot: startOnBoot(),
      });
      const shard = result.shard;
      if (!shard) {
        nav.pop();
        return;
      }
      // Show the new instance in place of this page.
      nav.replace({
        name: "shard",
        serverId: props.serverId,
        id: shard.id,
        title: shard.displayName || name().trim(),
        image: shard.displayImageSource ?? template.metadata?.displayImageSource,
      });
    } catch (e) {
      await fail(e);
    } finally {
      creating.set(false);
    }
  };

  return (
    <AppPage title="New instance">
      <View class="flex-1 bg-background">
        <Backdrop dim="strong" />
        <If
          when={chosen()}
          else={
            <View class="flex-1">
              <View class="w-full max-w-6xl gap-3 self-center px-4 pt-4 pb-2">
                <Text class="text-2xl font-bold text-foreground">Choose a game</Text>
                <View class="rounded-(--radius) border border-input bg-card px-3.5 py-3">
                  <Input
                    testID="template-search"
                    value={search()}
                    onChange={({ value }) => search.set(value)}
                    placeholder="Search the catalogue"
                    autoCapitalize="none"
                    returnKeyType="search"
                    class="p-0 text-base text-foreground placeholder:text-muted-foreground"
                  />
                </View>
                <If when={error()}>{(m) => <ErrorText message={m()} />}</If>
                <If when={!error() && templates() === null}>
                  <Text class="text-sm text-muted-foreground">Loading the catalogue…</Text>
                </If>
              </View>
              <Scroll class="flex-1">
                <View class="w-full max-w-6xl flex-row flex-wrap gap-3 self-center px-4 pt-1 pb-[calc(env(safe-area-inset-bottom)+24px)]">
                  <Each of={shown()} key={(t: AppSpec) => t.templateSlug}>
                    {(t) => <TemplateTile template={t()} serverUrl={serverUrl} onPress={() => choose(t())} />}
                  </Each>
                  <If when={templates() !== null && shown().length === 0}>
                    <Text class="text-sm text-muted-foreground">Nothing matches “{search()}”.</Text>
                  </If>
                </View>
              </Scroll>
            </View>
          }
        >
          {(t) => (
            <Scroll class="flex-1">
              <View class="w-full max-w-2xl gap-5 self-center px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
                <View class="overflow-hidden rounded-(--radius) border border-white/10 bg-card/85 shadow-lg">
                  <TemplateArt template={t()} serverUrl={serverUrl} />
                  <View class="gap-1 p-4">
                    <Text class="text-xl font-bold text-card-foreground">{title(t())}</Text>
                    <If when={t().metadata?.description}>
                      {(d) => <Text class="text-sm text-muted-foreground">{d()}</Text>}
                    </If>
                    <Text onPress={() => chosen.set(null)} class="pt-1 text-sm font-semibold text-primary">
                      Choose a different game
                    </Text>
                  </View>
                </View>

                <View class="gap-4 rounded-(--radius) border border-white/10 bg-card/85 p-4 shadow-lg">
                  <Field testID="instance-name" label="Name" value={name()} onChange={(v) => name.set(v)} />
                  <Field
                    testID="instance-description"
                    label="Description"
                    value={description()}
                    onChange={(v) => description.set(v)}
                    placeholder="Optional"
                  />
                  <If when={spires().length > 1}>
                    <View class="gap-1.5">
                      <Text class="text-sm font-semibold text-foreground">Machine</Text>
                      <Select
                        testID="machine"
                        title="Machine"
                        value={spireId() ?? ""}
                        options={spires().map((sp) => ({
                          value: sp.id,
                          label: sp.displayName || sp.id,
                          hint: sp.isLocal ? "This machine (where AMP runs)" : sp.description || undefined,
                        }))}
                        onChange={(v) => spireId.set(v)}
                      />
                    </View>
                  </If>
                  <Checkbox label="Install and start now" checked={startNow()} onChange={(v) => startNow.set(v)} />
                  <Checkbox label="Start when the machine boots" checked={startOnBoot()} onChange={(v) => startOnBoot.set(v)} />
                </View>

                <If when={t().metadata?.noCommercialUsage}>
                  <Text class="text-xs text-warning">This game's licence forbids commercial use.</Text>
                </If>
                <If when={error()}>{(m) => <ErrorText message={m()} />}</If>

                <PrimaryButton title={creating() ? "Creating…" : "Create instance"} onPress={create} disabled={creating()} />
              </View>
            </Scroll>
          )}
        </If>
      </View>
    </AppPage>
  );
}

function title(t: AppSpec): string {
  return t.metadata?.displayName || t.templateSlug;
}

function TemplateArt(props: { template: AppSpec; serverUrl: string }) {
  const src = () => artworkUrl(props.template.metadata?.displayImageSource, props.serverUrl, "banner");
  return (
    <View class="aspect-[460/215] w-full bg-secondary">
      <If
        when={src()}
        else={
          <View class="flex-1 items-center justify-center">
            <Text class="text-3xl">🎮</Text>
          </View>
        }
      >
        {(s) => <Image src={s()} class="absolute inset-0 h-full w-full object-cover" />}
      </If>
    </View>
  );
}

/** A catalogue entry: artwork and name, two to a row on phones. */
function TemplateTile(props: { template: AppSpec; serverUrl: string; onPress: () => void }) {
  return (
    <View
      role="button"
      testID={`template-${props.template.templateSlug}`}
      onPress={props.onPress}
      class="w-[48%] overflow-hidden rounded-xl border border-white/10 bg-card/85 shadow-md active:opacity-80 md:w-[31.5%] lg:w-[23.5%]"
    >
      <TemplateArt template={props.template} serverUrl={props.serverUrl} />
      <Text class="line-clamp-2 h-14 px-2.5 py-2 text-sm leading-5 font-semibold text-card-foreground">
        {title(props.template)}
      </Text>
    </View>
  );
}
