import { Scroll, signal, Text, View } from "nsh";
import { Input, NavPage } from "nsh/base";
import { AmpError } from "../api/client";
import { INFRA_FIELDS, type InfraField, infraFromString, infraProblem, infraSpec, infraToString } from "../api/infraFields";
import {
  checkboxValue,
  type EffectiveSetting,
  getSettingsLocale,
  getShard,
  getShardInfra,
  getShardSettings,
  isChecked,
  listItems,
  localize,
  patchShard,
  patchShardInfra,
  patchShardSettings,
  type SettingSpec,
  settingKind,
  type ShardInfraContext,
  type ShardInfraSettings,
  validateSetting,
} from "../api/manage";
import { Backdrop } from "../components/backdrop";
import { ErrorText, Field, PageHeader, PrimaryButton, SecondaryButton } from "../components/ui";
import { nav } from "../state/nav";
import { clearServerSession, clientFor } from "../state/servers";

interface Group {
  name: string;
  settings: EffectiveSetting[];
}

interface InfraGroup {
  name: string;
  fields: InfraField[];
}

/**
 * An instance's settings: its name and description (`PATCH /api/Shards/{id}`) and the
 * template's app settings (`/settings`), grouped by category, searchable, saved together.
 */
export function ShardSettingsScreen(props: { serverId: string; id: string; title: string }) {
  const settings = signal<EffectiveSetting[] | null>(null);
  const locale = signal<Record<string, unknown> | null>(null);
  const original = signal({ name: "", description: "" });
  const name = signal("");
  const description = signal("");
  const edits = signal<Record<string, string>>({});
  const infra = signal<ShardInfraContext | null>(null);
  const infraDenied = signal(false);
  const infraEdits = signal<Record<string, string>>({});
  const notice = signal<string | null>(null);
  const open = signal<Record<string, boolean>>({});
  const search = signal("");
  const error = signal<string | null>(null);
  const saving = signal(false);
  const saved = signal(false);

  const fail = async (e: unknown) => {
    if (e instanceof AmpError && e.isUnauthorized) {
      await clearServerSession(props.serverId);
      nav.setRoutes([{ name: "servers" }, { name: "signIn", serverId: props.serverId }]);
    } else if (e instanceof AmpError && e.status === 403) {
      error.set("Your account isn't allowed to change some of these settings.");
    } else {
      error.set((e as Error).message);
    }
  };

  const load = async () => {
    try {
      const client = clientFor(props.serverId);
      const [shard, list, loc, inf] = await Promise.all([
        getShard(client, props.id),
        getShardSettings(client, props.id),
        getSettingsLocale(client, props.id).catch(() => null),
        getShardInfra(client, props.id).catch((e) => {
          // Without `infra.read` the section is left out rather than failing the page.
          if (e instanceof AmpError && e.status === 403) {
            infraDenied.set(true);
            return null;
          }
          throw e;
        }),
      ]);
      infra.set(inf && typeof inf === "object" && inf.settings ? inf : null);
      infraEdits.set({});
      original.set({ name: shard.displayName ?? "", description: shard.description ?? "" });
      name.set(shard.displayName ?? "");
      description.set(shard.description ?? "");
      locale.set(loc);
      settings.set(list.filter((s) => !s.spec.hidden && (s.spec.inputType ?? "").toLowerCase() !== "hidden"));
      edits.set({});
    } catch (e) {
      await fail(e);
    }
  };
  load();

  const text = (s: string | undefined) => localize(locale(), s);
  const current = (field: string) => edits()[field] ?? settings()?.find((s) => s.spec.fieldName === field)?.value ?? "";
  const setValue = (field: string, value: string) => {
    saved.set(false);
    const was = settings()?.find((s) => s.spec.fieldName === field)?.value;
    const next = { ...edits() };
    if (value === was) delete next[field];
    else next[field] = value;
    edits.set(next);
  };

  /** A setting gated on another shows only while that one has the given value. */
  const visible = (spec: SettingSpec) => !spec.conditionSetting || current(spec.conditionSetting) === (spec.conditionValue ?? "");

  const groups = (): Group[] => {
    const q = search().trim().toLowerCase();
    const map = new Map<string, EffectiveSetting[]>();
    for (const s of settings() ?? []) {
      if (!visible(s.spec)) continue;
      if (q) {
        const hay = `${text(s.spec.displayName)} ${s.spec.fieldName} ${text(s.spec.description)} ${s.spec.keywords ?? ""}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      const cat = text(s.spec.category) || "General";
      map.set(cat, [...(map.get(cat) ?? []), s]);
    }
    return [...map.entries()].map(([groupName, list]) => ({
      name: groupName,
      settings: list.sort((a, b) => (a.spec.order ?? 0) - (b.spec.order ?? 0)),
    }));
  };

  // Infrastructure: values as form strings, edits by key.
  const infraValue = (key: keyof ShardInfraSettings): string => {
    const edited = infraEdits()[key];
    if (edited !== undefined) return edited;
    const field = INFRA_FIELDS.find((f) => f.key === key);
    const ctx = infra();
    return field && ctx ? infraToString(field, ctx.settings) : "";
  };
  const setInfra = (field: InfraField, value: string) => {
    saved.set(false);
    const ctx = infra();
    const was = ctx ? infraToString(field, ctx.settings) : "";
    const next = { ...infraEdits() };
    if (value === was) delete next[field.key];
    else next[field.key] = value;
    infraEdits.set(next);
  };
  const infraShown = (f: InfraField) => {
    const ctx = infra();
    return !!ctx && (!f.show || f.show(ctx, infraValue));
  };
  const infraGroups = (): InfraGroup[] => {
    const map = new Map<string, InfraField[]>();
    for (const f of INFRA_FIELDS) if (infraShown(f)) map.set(f.group, [...(map.get(f.group) ?? []), f]);
    return [...map.entries()].map(([groupName, fields]) => ({ name: groupName, fields }));
  };
  const infraFieldProblem = (f: InfraField): string | null => {
    const ctx = infra();
    if (!ctx || !(f.key in infraEdits())) return null;
    return validateSetting(infraSpec(f, ctx), infraValue(f.key)) ?? infraProblem(f, infraValue(f.key), infraValue);
  };

  const detailsChanged = () => name().trim() !== original().name || description().trim() !== original().description;
  const changeCount = () => Object.keys(edits()).length + Object.keys(infraEdits()).length + (detailsChanged() ? 1 : 0);
  const problems = () =>
    Object.entries(edits())
      .map(([field, value]) => {
        const spec = settings()?.find((s) => s.spec.fieldName === field)?.spec;
        return spec ? validateSetting(spec, value) : null;
      })
      .filter(Boolean).length + INFRA_FIELDS.filter((f) => infraShown(f) && infraFieldProblem(f)).length;

  const save = async () => {
    if (saving() || changeCount() === 0) return;
    if (problems() > 0) {
      error.set("Fix the highlighted settings first.");
      return;
    }
    if (!name().trim()) {
      error.set("The instance needs a name.");
      return;
    }
    saving.set(true);
    error.set(null);
    notice.set(null);
    try {
      const client = clientFor(props.serverId);
      if (detailsChanged()) {
        await patchShard(client, props.id, { displayName: name().trim(), description: description().trim() });
      }
      if (Object.keys(edits()).length) await patchShardSettings(client, props.id, edits());
      if (Object.keys(infraEdits()).length) {
        const patch: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(infraEdits())) {
          const field = INFRA_FIELDS.find((f) => f.key === key);
          if (field) patch[key] = infraFromString(field, value);
        }
        const result = await patchShardInfra(client, props.id, patch as Partial<ShardInfraSettings>);
        const refused = result.clampRefused;
        if (refused) {
          notice.set(
            `The player cap was saved, but the game's own max players couldn't be lowered to match: ${
              typeof refused === "string" ? refused : (refused.message ?? refused.code ?? "no reason given")
            }`,
          );
        }
      }
      await load();
      saved.set(true);
    } catch (e) {
      await fail(e);
    } finally {
      saving.set(false);
    }
  };

  const discard = () => {
    edits.set({});
    infraEdits.set({});
    name.set(original().name);
    description.set(original().description);
    error.set(null);
  };

  return (
    <NavPage title="Settings" header={<PageHeader title={`${props.title} settings`} />}>
      <View class="flex-1 bg-background">
        <Backdrop dim="strong" />
        <Scroll class="flex-1" keyboardDismissMode="on-drag">
          <View class="gap-4 p-4 pb-32">
            <View class="gap-4 rounded-(--radius) border border-white/10 bg-card/85 p-4 shadow-lg">
              <Text class="text-xs font-semibold tracking-widest text-muted-foreground">DETAILS</Text>
              <Field testID="details-name" label="Name" value={name()} onChange={(v) => (saved.set(false), name.set(v))} />
              <Field
                testID="details-description"
                label="Description"
                value={description()}
                onChange={(v) => (saved.set(false), description.set(v))}
                placeholder="Optional"
              />
            </View>

            <Input
              testID="settings-search"
              value={search()}
              onChange={({ value }) => search.set(value)}
              placeholder="Search settings"
              autoCapitalize="none"
              returnKeyType="search"
              class="rounded-(--radius) border border-input bg-card px-3.5 py-3 text-base text-foreground placeholder:text-muted-foreground"
            />

            <If when={error()}>{(m) => <ErrorText message={m()} />}</If>
            <If when={notice()}>{(m) => <Text class="text-sm text-warning">{m()}</Text>}</If>
            <If when={saved() && changeCount() === 0}>
              <Text class="text-sm text-success">Saved. Some changes only take effect after a restart.</Text>
            </If>
            <If when={settings() === null && !error()}>
              <Text class="text-sm text-muted-foreground">Loading settings…</Text>
            </If>

            <Each of={groups()} key={(g: Group) => g.name}>
              {(group) => (
                <View class="overflow-hidden rounded-(--radius) border border-white/10 bg-card/85 shadow-lg">
                  <View
                    role="button"
                    testID={`group-${group().name}`}
                    onPress={() => open.set({ ...open(), [group().name]: !open()[group().name] })}
                    class="flex-row items-center gap-3 px-4 py-3.5 active:bg-accent"
                  >
                    <Text class="flex-1 text-base font-semibold text-card-foreground">{group().name}</Text>
                    <Text class="text-xs text-muted-foreground">{String(group().settings.length)}</Text>
                    <Text class="text-base text-muted-foreground">{open()[group().name] || search().trim() ? "▾" : "▸"}</Text>
                  </View>
                  <If when={open()[group().name] || search().trim()}>
                    <View class="gap-5 border-t border-white/10 px-4 py-4">
                      <Each of={group().settings} key={(s: EffectiveSetting) => s.spec.fieldName}>
                        {(s) => (
                          <SettingRow
                            spec={s().spec}
                            label={text(s().spec.displayName) || s().spec.fieldName}
                            description={text(s().spec.description)}
                            options={s().spec.enumValues ? Object.entries(s().spec.enumValues!).map(([k, v]) => [k, text(v)] as [string, string]) : []}
                            value={current(s().spec.fieldName)}
                            changed={s().spec.fieldName in edits()}
                            onChange={(v) => setValue(s().spec.fieldName, v)}
                          />
                        )}
                      </Each>
                    </View>
                  </If>
                </View>
              )}
            </Each>
            <If when={settings() !== null && groups().length === 0 && search().trim()}>
              <Text class="text-sm text-muted-foreground">No settings match “{search()}”.</Text>
            </If>

            <If when={search().trim() ? null : infra()}>
              {(ctx) => (
                <View class="gap-3 pt-2">
                  <View class="flex-row items-baseline justify-between px-1">
                    <Text class="text-xs font-semibold tracking-widest text-muted-foreground">INFRASTRUCTURE</Text>
                    <Text class="text-xs text-muted-foreground">on {ctx().spireName}</Text>
                  </View>
                  <Each of={infraGroups()} key={(g: InfraGroup) => g.name}>
                    {(group) => (
                      <View class="overflow-hidden rounded-(--radius) border border-white/10 bg-card/85 shadow-lg">
                        <View
                          role="button"
                          testID={`group-${group().name}`}
                          onPress={() => open.set({ ...open(), [`infra:${group().name}`]: !open()[`infra:${group().name}`] })}
                          class="flex-row items-center gap-3 px-4 py-3.5 active:bg-accent"
                        >
                          <Text class="flex-1 text-base font-semibold text-card-foreground">{group().name}</Text>
                          <Text class="text-base text-muted-foreground">{open()[`infra:${group().name}`] ? "▾" : "▸"}</Text>
                        </View>
                        <If when={open()[`infra:${group().name}`]}>
                          <View class="gap-5 border-t border-white/10 px-4 py-4">
                            <Each of={group().fields} key={(f: InfraField) => f.key}>
                              {(f) => (
                                <SettingRow
                                  spec={infraSpec(f(), ctx())}
                                  label={f().label}
                                  description={f().description ?? ""}
                                  options={
                                    f().type === "select"
                                      ? Object.entries(infraSpec(f(), ctx()).enumValues ?? {}).map(([k, v]) => [k, v] as [string, string])
                                      : []
                                  }
                                  value={infraValue(f().key)}
                                  changed={f().key in infraEdits()}
                                  problem={infraFieldProblem(f())}
                                  onChange={(v) => setInfra(f(), v)}
                                />
                              )}
                            </Each>
                            <If when={group().name === "Container and limits" && infraValue("containerMode") === "Native"}>
                              <Text class="text-xs text-muted-foreground">
                                Memory and CPU limits apply only when the instance runs in a container.
                              </Text>
                            </If>
                          </View>
                        </If>
                      </View>
                    )}
                  </Each>
                </View>
              )}
            </If>
            <If when={infraDenied()}>
              <Text class="text-xs text-muted-foreground">Your account can't view this instance's infrastructure settings.</Text>
            </If>
          </View>
        </Scroll>

        <If when={changeCount() > 0}>
          <View class="flex-row gap-3 border-t border-white/10 bg-card/95 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+12px)] mb-[env(keyboard-inset-height)]">
            <SecondaryButton title="Discard" onPress={discard} disabled={saving()} />
            <View class="flex-[2]">
              <PrimaryButton
                title={saving() ? "Saving…" : `Save ${changeCount()} change${changeCount() === 1 ? "" : "s"}`}
                onPress={save}
                disabled={saving()}
              />
            </View>
          </View>
        </If>
      </View>
    </NavPage>
  );
}

/** One setting: its label, help, the control its input type asks for, and any problem. */
function SettingRow(props: {
  spec: SettingSpec;
  label: string;
  description: string;
  options: [string, string][];
  value: string;
  changed: boolean;
  /** A problem found by the caller; otherwise the spec's own checks run. */
  problem?: string | null;
  onChange: (value: string) => void;
}) {
  const kind = () => {
    const k = settingKind(props.spec.inputType);
    // The server rewrites IP binding into a select of the machine's addresses.
    return k === "ipbinding" && props.options.length ? "select" : k;
  };
  const readOnly = () => !!props.spec.readOnly || kind() === "credential";
  const problem = () => (props.problem !== undefined ? props.problem : props.changed ? validateSetting(props.spec, props.value) : null);
  const dropdown = signal(false);
  const inputClass = () =>
    `rounded-lg border px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground ${
      problem() ? "border-destructive" : props.changed ? "border-primary" : "border-input"
    } ${readOnly() ? "bg-muted/40 opacity-70" : "bg-background/60"}`;

  return (
    <View class="gap-1.5" testID={`setting-${props.spec.fieldName}`}>
      <If
        when={kind() === "checkbox"}
        else={
          <View class="flex-row items-baseline gap-2">
            <Text class="flex-1 text-sm font-semibold text-card-foreground">{props.label}</Text>
            <If when={props.changed}>
              <Text class="text-xs font-semibold text-primary">edited</Text>
            </If>
          </View>
        }
      >
        <View
          role="switch"
          onPress={() => !readOnly() && props.onChange(checkboxValue(props.spec, !isChecked(props.spec, props.value)))}
          class="flex-row items-center gap-3"
        >
          <Text class="flex-1 text-sm font-semibold text-card-foreground">{props.label}</Text>
          <View
            class={`h-7 w-12 justify-center rounded-full px-0.5 ${isChecked(props.spec, props.value) ? "bg-primary" : "bg-muted"}`}
          >
            <View
              class={`h-6 w-6 rounded-full bg-white shadow ${isChecked(props.spec, props.value) ? "self-end" : "self-start"}`}
            />
          </View>
        </View>
      </If>

      <If when={props.description}>{(d) => <Text class="text-xs text-muted-foreground">{d()}</Text>}</If>

      <If when={kind() === "select"}>
        <View
          role="button"
          onPress={() => !readOnly() && dropdown.set(!dropdown())}
          class={`flex-row items-center ${inputClass()}`}
        >
          <Text class="flex-1 text-base text-foreground">
            {props.options.find(([k]) => k === props.value)?.[1] ?? (props.value || "Choose…")}
          </Text>
          <Text class="text-muted-foreground">{dropdown() ? "▴" : "▾"}</Text>
        </View>
        <If when={dropdown()}>
          <View class="overflow-hidden rounded-lg border border-input bg-background/80">
            <Each of={props.options}>
              {(option) => (
                <View
                  role="radio"
                  onPress={() => {
                    props.onChange(option()[0]);
                    dropdown.set(false);
                  }}
                  class={`px-3 py-2.5 active:bg-accent ${option()[0] === props.value ? "bg-primary/15" : ""}`}
                >
                  <Text class={`text-sm ${option()[0] === props.value ? "font-semibold text-primary" : "text-foreground"}`}>
                    {option()[1] || option()[0]}
                  </Text>
                </View>
              )}
            </Each>
          </View>
        </If>
      </If>

      <If when={kind() === "list" || kind() === "multiline"}>
        <Input
          multiline
          value={kind() === "list" ? listItems(props.value).join("\n") : props.value}
          onChange={({ value }) =>
            props.onChange(kind() === "list" ? JSON.stringify(value.split("\n").filter((l) => l.trim() !== "")) : value)
          }
          readonly={readOnly()}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={kind() === "list" ? "One per line" : props.spec.placeholder}
          class={`min-h-24 ${inputClass()}`}
        />
      </If>

      <If when={["text", "password", "number", "quantity", "combo", "ipbinding"].includes(kind())}>
        <View class="flex-row items-center gap-2">
          <Input
            value={props.value}
            onChange={({ value }) => props.onChange(value)}
            masked={kind() === "password" || !!props.spec.isSecret}
            readonly={readOnly()}
            keyboardType={kind() === "number" || kind() === "quantity" ? "numbers-and-punctuation" : "default"}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={props.spec.placeholder || props.spec.defaultValue || ""}
            class={`flex-1 ${inputClass()}`}
          />
          <If when={props.spec.suffix}>{(s) => <Text class="text-sm text-muted-foreground">{s()}</Text>}</If>
        </View>
      </If>

      <If when={kind() === "credential"}>
        <Text class="text-xs text-muted-foreground">Shared credentials are managed in the web panel.</Text>
      </If>
      <If when={problem()}>{(p) => <Text class="text-xs text-destructive">{p()}</Text>}</If>
    </View>
  );
}
