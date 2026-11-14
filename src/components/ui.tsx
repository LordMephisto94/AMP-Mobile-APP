import { Image, type JSX, Text, View } from "nsh";
import mark from "../../assets/amp-mark.png";
import { Button, Input, NavPage } from "nsh/base";
import { nav } from "../state/nav";

/** The app's main call to action: a violet-to-pink gradient button. */
export function PrimaryButton(props: { title: string; onPress: () => void; disabled?: boolean; icon?: string }) {
  return (
    <Button
      onPress={() => {
        if (!props.disabled) props.onPress();
      }}
      class={`flex-row items-center justify-center gap-2 rounded-(--radius) px-5 py-3.5 ${
        props.disabled ? "bg-muted" : "bg-linear-to-r from-hero-from to-hero-to shadow-md active:opacity-85"
      }`}
    >
      <If when={props.icon}>
        {(icon) => <Text class={`text-lg ${props.disabled ? "text-muted-foreground" : "text-white"}`}>{icon()}</Text>}
      </If>
      <Text class={`text-base font-semibold ${props.disabled ? "text-muted-foreground" : "text-white"}`}>
        {props.title}
      </Text>
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
      class={`flex-1 items-center rounded-(--radius) px-4 py-3 active:opacity-70 ${props.disabled ? "opacity-50" : ""} ${tone()[0]}`}
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
    <View role="checkbox" testID={props.testID} onPress={() => props.onChange(!props.checked)} class="flex-row items-center gap-3 py-1">
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

/**
 * The app's own top bar, on every platform (the system's is hidden): room for the status
 * bar, a round back button when there's somewhere to go back to, the AMP mark, the title
 * and an optional subtitle, and an optional control on the right.
 */
export function PageHeader(props: { title: string; subtitle?: string; right?: JSX.Element; onBack?: () => void }) {
  return (
    <View class="flex-row items-center gap-3 border-b border-white/10 bg-card/85 px-3 pt-[calc(env(safe-area-inset-top)+8px)] pb-2.5 shadow-lg">
      <If when={nav.routes().length > 1}>
        <View
          role="button"
          accessibilityLabel="Back"
          testID="back"
          onPress={() => (props.onBack ? props.onBack() : nav.pop())}
          class="h-10 w-10 items-center justify-center rounded-full bg-primary/15 active:bg-primary/30"
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
