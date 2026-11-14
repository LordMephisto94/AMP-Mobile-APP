import { cleanup, effect, Overlay, signal, Text, View, windowSize } from "nsh";
import { Input } from "nsh/base";
import { BackHandler } from "nsh/mobile";

export interface PromptRequest {
  title: string;
  message?: string;
  value?: string;
  placeholder?: string;
  confirm: string;
  /** An emoji shown in a tinted circle above the title. */
  icon?: string;
  /** Returns an error to show, or nothing to close. */
  onSubmit: (value: string) => Promise<string | void> | string | void;
}

/**
 * A text prompt in the app's own dialog style (the system's alert has no text field and
 * looks like the system). Show one by passing `request`; it calls `onClose` when done.
 */
export function Prompt(props: { request: PromptRequest | null; onClose: () => void }) {
  const value = signal("");
  const error = signal<string | null>(null);
  const busy = signal(false);
  const shown = signal(false);
  let shownFor: PromptRequest | null = null;

  const sync = () => {
    if (props.request && props.request !== shownFor) {
      shownFor = props.request;
      value.set(props.request.value ?? "");
      error.set(null);
    }
    if (!props.request) shownFor = null;
    return props.request;
  };

  const close = () => {
    if (busy()) return;
    shown.set(false);
    setTimeout(props.onClose, 140);
  };

  effect(() => {
    if (!props.request) return;
    shown.set(false);
    const t = setTimeout(() => shown.set(true), 16);
    let stopBack = () => {};
    try {
      stopBack = BackHandler.on("press", () => {
        close();
        return true;
      });
    } catch {
      // no back button on this platform
    }
    cleanup(() => {
      clearTimeout(t);
      stopBack();
    });
  });

  const submit = async () => {
    const request = props.request;
    if (!request || busy()) return;
    busy.set(true);
    try {
      const problem = await request.onSubmit(value().trim());
      if (problem) error.set(problem);
      else {
        busy.set(false);
        close();
      }
    } catch (e) {
      error.set((e as Error).message);
    } finally {
      busy.set(false);
    }
  };

  const screen = () => ({ width: windowSize().width, height: windowSize().height });

  return (
    <If when={sync()}>
      {(request) => (
        <Overlay>
          <View
            testID="prompt-backdrop"
            onPress={close}
            style={screen()}
            class={`absolute top-0 left-0 bg-black/65 transition-opacity duration-150 ${shown() ? "opacity-100" : "opacity-0"}`}
          />
          <View
            style={{ ...screen(), pointerEvents: "box-none" }}
            class="absolute top-0 left-0 items-center justify-center px-7 pb-[env(keyboard-inset-height)]"
          >
            <View
              class={`w-full max-w-sm gap-4 rounded-3xl border border-white/10 bg-popover p-6 shadow-2xl transition-all duration-150 ease-out ${
                shown() ? "scale-100 opacity-100" : "scale-95 opacity-0"
              }`}
            >
              <If when={request().icon}>
                {(icon) => (
                  <View class="h-12 w-12 items-center justify-center self-center rounded-full bg-primary/15">
                    <Text class="text-2xl">{icon()}</Text>
                  </View>
                )}
              </If>
              <View class="gap-1.5">
                <Text class="text-center text-lg font-semibold text-popover-foreground">{request().title}</Text>
                <If when={request().message}>{(m) => <Text class="text-center text-sm text-muted-foreground">{m()}</Text>}</If>
              </View>
              <View class={`rounded-xl border bg-background px-3.5 py-3 ${error() ? "border-destructive" : "border-input"}`}>
                <Input
                  testID="prompt-input"
                  value={value()}
                  onChange={({ value: v }) => (error.set(null), value.set(v))}
                  onSubmit={submit}
                  submitBehavior="submit"
                  returnKeyType="done"
                  placeholder={request().placeholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                  class="p-0 text-base text-foreground placeholder:text-muted-foreground"
                />
              </View>
              <If when={error()}>{(m) => <Text class="-mt-2 text-sm text-destructive">{m()}</Text>}</If>
              <View class="flex-row gap-2.5">
                <View
                  role="button"
                  testID="prompt-cancel"
                  onPress={close}
                  class="flex-1 items-center rounded-xl bg-secondary px-4 py-3 active:opacity-80"
                >
                  <Text class="text-[15px] font-semibold text-secondary-foreground">Cancel</Text>
                </View>
                <View
                  role="button"
                  testID="prompt-confirm"
                  onPress={submit}
                  class={`flex-1 items-center rounded-xl px-4 py-3 ${busy() ? "bg-muted" : "bg-linear-to-r from-hero-from to-hero-to active:opacity-80"}`}
                >
                  <Text class={`text-[15px] font-semibold ${busy() ? "text-muted-foreground" : "text-white"}`}>
                    {busy() ? "Working…" : request().confirm}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </Overlay>
      )}
    </If>
  );
}
