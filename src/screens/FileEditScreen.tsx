import { signal, Text, View } from "nsh";
import { Input, NavPage } from "nsh/base";
import { AmpError } from "../api/client";
import { readText, writeText } from "../api/files";
import { Backdrop } from "../components/backdrop";
import { confirm } from "../components/Confirm";
import { ErrorText, PageHeader } from "../components/ui";
import { nav } from "../state/nav";
import { clearServerSession, clientFor } from "../state/servers";

/** Files larger than this open read-only: a phone's text field isn't a place for them. */
const MAX_EDIT_CHARS = 1_000_000;

/**
 * Edits a text file. AMP-managed files are flagged: `generated` ones are rewritten on every
 * start, so they open read-only; in `merged` ones AMP owns some values.
 */
export function FileEditScreen(props: { serverId: string; id: string; path: string; managed?: string | null }) {
  const original = signal<string | null>(null);
  const text = signal("");
  const error = signal<string | null>(null);
  const saving = signal(false);
  const saved = signal(false);
  const name = props.path.split("/").at(-1) ?? props.path;

  const fail = async (e: unknown) => {
    if (e instanceof AmpError && e.isUnauthorized) {
      await clearServerSession(props.serverId);
      nav.setRoutes([{ name: "servers" }, { name: "signIn", serverId: props.serverId }]);
    } else if (e instanceof AmpError && e.status === 403) {
      error.set("Your account isn't allowed to open or change this file.");
    } else {
      error.set((e as Error).message);
    }
  };

  (async () => {
    try {
      const content = await readText(clientFor(props.serverId), props.id, props.path);
      original.set(content);
      text.set(content);
    } catch (e) {
      await fail(e);
    }
  })();

  const tooBig = () => (original()?.length ?? 0) > MAX_EDIT_CHARS;
  const readOnly = () => props.managed === "generated" || tooBig() || original() === null;
  const dirty = () => original() !== null && text() !== original();

  const save = async () => {
    if (!dirty() || saving() || readOnly()) return;
    saving.set(true);
    error.set(null);
    try {
      await writeText(clientFor(props.serverId), props.id, props.path, text());
      original.set(text());
      saved.set(true);
    } catch (e) {
      await fail(e);
    } finally {
      saving.set(false);
    }
  };

  const leave = async () => {
    if (!dirty()) return true;
    const action = await confirm({
      title: "Discard your changes?",
      message: `${name} has unsaved changes.`,
      icon: "📝",
      tone: "danger",
      cancelLabel: "Keep editing",
      actions: [{ id: "discard", label: "Discard", tone: "danger" }],
    });
    return action === "discard";
  };

  const SaveButton = () => (
    <Text
      role="button"
      testID="save-file"
      onPress={save}
      class={`text-base font-semibold ${dirty() && !saving() ? "text-primary" : "text-muted-foreground"}`}
    >
      {saving() ? "Saving…" : "Save"}
    </Text>
  );

  return (
    <NavPage
      title={name}
      popOnBack={!dirty()}
      onBackPress={async () => {
        if (dirty() && (await leave())) {
          original.set(text());
          nav.pop();
        }
      }}
      headerRight={<SaveButton />}
      header={<PageHeader title={name} subtitle={`/${props.path}`} right={<SaveButton />} />}
    >
      <View class="flex-1 bg-background">
        <Backdrop dim="strong" />
        <If when={error()}>
          {(m) => (
            <View class="px-4 pt-3">
              <ErrorText message={m()} />
            </View>
          )}
        </If>
        <If when={props.managed === "generated"}>
          <Text class="px-4 pt-3 text-xs text-warning">AMP rewrites this file from the instance's settings on every start, so it's read-only here. Change the settings instead.</Text>
        </If>
        <If when={props.managed === "merged"}>
          <Text class="px-4 pt-3 text-xs text-warning">AMP writes some values in this file from the instance's settings; edits to those may be replaced.</Text>
        </If>
        <If when={tooBig()}>
          <Text class="px-4 pt-3 text-xs text-warning">This file is too large to edit on a phone; it's shown read-only.</Text>
        </If>
        <If when={saved() && !dirty()}>
          <Text class="px-4 pt-3 text-xs text-success">Saved.</Text>
        </If>
        <If
          when={original() !== null}
          else={
            <If when={!error()}>
              <Text class="p-4 text-sm text-muted-foreground">Loading…</Text>
            </If>
          }
        >
          <View class="flex-1 pb-[env(safe-area-inset-bottom)]">
            <View class="flex-1 px-3 pt-3 pb-[calc(env(keyboard-inset-height)+12px)]">
              <View class="flex-1 rounded-lg border border-input bg-black/50 p-3">
                <Input
                  testID="file-content"
                  multiline
                  value={text()}
                  onChange={({ value }) => (saved.set(false), text.set(value))}
                  readonly={readOnly()}
                  autoCapitalize="none"
                  autoCorrect={false}
                  class="p-0 flex-1 font-mono text-xs leading-5 text-foreground"
                />
              </View>
            </View>
          </View>
        </If>
      </View>
    </NavPage>
  );
}
