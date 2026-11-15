import { Image, type JSX, Text, View } from "nsh";
import mark from "../../assets/amp-mark.png";
import { Button, Input, NavPage } from "nsh/base";
import { nav } from "../state/nav";
import { Icon, type IconName } from "./Icon";

/** Shown while the keyboard has the focus on a control (on platforms that move focus between controls). */
export const FOCUS = "focus-visible:ring-2 focus-visible:ring-ring";

/** The app's main call to action: a solid accent button, with the theme's readable text on it. */
export function PrimaryButton(props: { title: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Button
      onPress={() => {
        if (!props.disabled) props.onPress();
      }}
      class={`items-center justify-center rounded-(--radius) px-5 py-3.5 ${FOCUS} ${props.disabled ? "bg-muted" : "bg-primary active:opacity-85"}`}
    >
      <Text class={`text-base font-semibold ${props.disabled ? "text-muted-foreground" : "text-primary-foreground"}`}>{props.title}</Text>
    </Button>
  );
}

/** A quieter button for secondary actions. */
export function SecondaryButton(props: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "default" | "success" | "warning" | "danger";
  testID?: string;
}) {
  const tone = () =>
    ({
      default: ["bg-secondary", "text-secondary-foreground"],
      success: ["bg-success/15", "text-success"],
      warning: ["bg-warning/15", "text-warning"],
      danger: ["bg-destructive/15", "text-destructive"],
    })[props.tone ?? "default"];
  return (
    <Button
      testID={props.testID}
      onPress={() => {
        if (!props.disabled) props.onPress();
      }}
      class={`flex-1 items-center rounded-(--radius) px-4 py-3 active:opacity-70 ${FOCUS} ${props.disabled ? "opacity-50" : ""} ${tone()[0]}`}
    >
      <Text class={`text-base font-semibold ${tone()[1]}`}>{props.title}</Text>
    </Button>
  );
}

/** A labelled single-line text field. */
export function Field(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  masked?: boolean;
  keyboardType?: "default" | "url" | "email-address";
  testID?: string;
}) {
  return (
    <View class="gap-1.5">
      <Text class="text-sm font-semibold text-foreground">{props.label}</Text>
      {/* Border and padding on a wrapper: Android's text field doesn't inset its text by its own padding. */}
      <View class="rounded-(--radius) border border-input bg-card px-3.5 py-3">
        <Input
          testID={props.testID}
          value={props.value}
          onChange={({ value }) => props.onChange(value)}
          placeholder={props.placeholder}
          masked={props.masked}
          keyboardType={props.keyboardType ?? "default"}
          autoCapitalize="none"
          // Addresses, user names and passwords: the keyboard shouldn't correct or learn them.
          autoCorrect={false}
          class="p-0 text-base text-foreground placeholder:text-muted-foreground"
        />
      </View>
      <If when={props.hint}>{(hint) => <Text class="text-xs text-muted-foreground">{hint()}</Text>}</If>
    </View>
  );
}

/** A tappable checkbox with a label. */
export function Checkbox(props: { label: string; checked: boolean; onChange: (checked: boolean) => void; testID?: string }) {
  return (
    <View role="checkbox" testID={props.testID} onPress={() => props.onChange(!props.checked)} class={`flex-row items-center gap-3 rounded-md py-1 ${FOCUS}`}>
      <View
        class={`h-6 w-6 items-center justify-center rounded-md border-2 ${props.checked ? "border-primary bg-primary" : "border-input bg-card"}`}
      >
        <If when={props.checked}>
          <Text class="text-sm font-bold text-primary-foreground">✓</Text>
        </If>
      </View>
      <Text class="text-base text-foreground">{props.label}</Text>
    </View>
  );
}

/** An on/off control with a label and a line on what it does. */
export function Switch(props: { label: string; hint?: string; value: boolean; onChange: (value: boolean) => void; testID?: string }) {
  return (
    <View
      role="switch"
      testID={props.testID}
      accessibilityLabel={`${props.label}, ${props.value ? "on" : "off"}`}
      onPress={() => props.onChange(!props.value)}
      class={`flex-row items-center gap-3 rounded-(--radius) py-1 ${FOCUS}`}
    >
      <View class="flex-1 gap-0.5">
        <Text class="text-base font-semibold text-card-foreground">{props.label}</Text>
        <If when={props.hint}>{(h) => <Text class="text-xs text-muted-foreground">{h()}</Text>}</If>
      </View>
      <View class={`h-7 w-12 justify-center rounded-full border px-0.5 ${props.value ? "items-end border-primary bg-primary" : "items-start border-input bg-secondary"}`}>
        <View class={`h-6 w-6 rounded-full ${props.value ? "bg-primary-foreground" : "bg-muted-foreground"}`} />
      </View>
    </View>
  );
}

/** A row of choices where exactly one is selected (the selected one says so to screen readers). */
export function Segmented<T extends string>(props: { value: T; options: { id: T; label: string }[]; onChange: (id: T) => void; testID: string }) {
  return (
    <View class="flex-row flex-wrap gap-2">
      <Each of={props.options}>
        {(o) => (
          <Text
            role="button"
            testID={`${props.testID}-${o().id}`}
            accessibilityLabel={`${o().label}${props.value === o().id ? ", selected" : ""}`}
            onPress={() => props.onChange(o().id)}
            class={`rounded-(--radius) border px-3.5 py-2 text-sm font-semibold ${FOCUS} ${
              props.value === o().id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground"
            }`}
          >
            {o().label}
          </Text>
        )}
      </Each>
    </View>
  );
}

/** An error message in a tinted box. */
export function ErrorText(props: { message: string }) {
  return (
    <View class="rounded-(--radius) border border-destructive/30 bg-destructive/10 px-3.5 py-3">
      <Text class="text-sm text-destructive">{props.message}</Text>
    </View>
  );
}

/** A small coloured status pill. */
export function Pill(props: { label: string; tone: "success" | "muted" | "warning" | "danger" }) {
  const classes = () =>
    ({
      success: ["bg-success/15", "text-success"],
      muted: ["bg-muted", "text-muted-foreground"],
      warning: ["bg-warning/15", "text-warning"],
      danger: ["bg-destructive/15", "text-destructive"],
    })[props.tone];
  return (
    <View class={`self-start rounded-full px-2.5 py-1 ${classes()[0]}`}>
      <Text class={`text-xs font-semibold ${classes()[1]}`}>{props.label}</Text>
    </View>
  );
}

/** A row that opens another page: a title, a line on what is there, and a chevron. Rows in one card are divided by a hairline. */
export function NavRow(props: { title: string; hint?: string; icon?: IconName; onPress: () => void; testID?: string }) {
  return (
    <View role="button" testID={props.testID} onPress={props.onPress} class={`flex-row items-center gap-3 border-b border-border px-4 py-3.5 active:bg-accent ${FOCUS}`}>
      <If when={props.icon}>{(i) => <Icon name={i()} tone="accent" size={22} />}</If>
      <View class="flex-1">
        <Text class="text-base font-semibold text-card-foreground">{props.title}</Text>
        <If when={props.hint}>{(h) => <Text class="text-xs text-muted-foreground">{h()}</Text>}</If>
      </View>
      <Text class="text-xl text-muted-foreground">›</Text>
    </View>
  );
}

/**
 * The app's own top bar, on every platform (the system's is hidden): room for the status
 * bar, a round back button when there's somewhere to go back to, the AMP mark, the title
 * and an optional subtitle, and an optional control on the right.
 */
export function PageHeader(props: { title: string; subtitle?: string; right?: JSX.Element; onBack?: () => void }) {
  return (
    <View class="flex-row items-center gap-3 border-b border-border bg-card px-3 pt-[calc(env(safe-area-inset-top)+8px)] pb-2.5">
      <If when={nav.routes().length > 1}>
        <View
          role="button"
          accessibilityLabel="Back"
          testID="back"
          onPress={() => (props.onBack ? props.onBack() : nav.pop())}
          class={`h-10 w-10 items-center justify-center rounded-full bg-primary/15 active:bg-primary/30 ${FOCUS}`}
        >
          <Text class="-mt-0.5 text-2xl leading-none font-semibold text-primary">‹</Text>
        </View>
      </If>
      <Image src={mark} accessibilityLabel="AMP" class="h-6 w-6 object-contain" />
      <View class="flex-1">
        <Text class="line-clamp-1 text-[17px] font-semibold text-foreground">{props.title}</Text>
        <If when={props.subtitle}>{(s) => <Text class="line-clamp-1 text-xs text-muted-foreground">{s()}</Text>}</If>
      </View>
      {props.right}
    </View>
  );
}

/**
 * A page of the navigation stack with the app's own header instead of the system's bar
 * (which Android and iOS would draw grey). Back gestures and Android's back button still
 * work; `onBack` with `popOnBack={false}` lets a page ask first.
 */
export function AppPage(props: {
  title: string;
  subtitle?: string;
  right?: JSX.Element;
  /** false: the system back (Android's button, iOS swipe) doesn't pop the page; `onBack` decides. */
  popOnBack?: boolean;
  /** Replaces the plain pop for the header's back button, and for the system back while `popOnBack` is false. */
  onBack?: () => void;
  children?: JSX.Element;
}) {
  return (
    <NavPage
      title={props.title}
      headerVisible={false}
      popOnBack={props.popOnBack}
      onBackPress={() => {
        if (props.popOnBack === false) props.onBack?.();
      }}
    >
      <View class="flex-1 bg-background">
        <PageHeader title={props.title} subtitle={props.subtitle} right={props.right} onBack={props.onBack} />
        <View class="flex-1">{props.children}</View>
      </View>
    </NavPage>
  );
}
