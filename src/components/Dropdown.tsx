import { type JSX, Text, View } from "nsh";
import { Popover } from "nsh/base";

export interface DropdownItem {
  id: string;
  label: string;
  /** An emoji or symbol before the label. */
  icon?: string;
  /** `danger` items are red and set apart below a divider. */
  tone?: "default" | "danger";
  hint?: string;
  onSelect: () => void;
}

/**
 * The app's own dropdown menu: a glassy card anchored under its trigger, which fades and
 * scales in, instead of the system's action sheet. Pressing outside or Back closes it.
 * Controlled: pass `open` and `onOpenChange` (so a long press elsewhere can open it too).
 */
export function Dropdown(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: JSX.Element;
  items: DropdownItem[];
  title?: string;
  testID?: string;
}) {
  const normal = () => props.items.filter((i) => i.tone !== "danger");
  const danger = () => props.items.filter((i) => i.tone === "danger");

  const pick = (item: DropdownItem) => {
    props.onOpenChange(false);
    item.onSelect();
  };

  return (
    <Popover
      open={props.open}
      onOpenChange={(e) => props.onOpenChange(e.open)}
      placement="bottom"
      align="end"
      offset={6}
      margin={12}
      popupClass="min-w-56 overflow-hidden rounded-2xl border border-white/10 bg-popover/95 py-1.5 shadow-2xl backdrop-blur-xl transition-all duration-150 ease-out"
      popupStartingClass="opacity-0 scale-95 -translate-y-1"
      popupEndingClass="opacity-0 scale-95 -translate-y-1"
      trigger={props.trigger}
    >
      <View testID={props.testID}>
        <If when={props.title}>
          {(t) => (
            <Text class="line-clamp-1 px-4 pt-1.5 pb-2 text-xs font-semibold tracking-wider text-muted-foreground">
              {t().toUpperCase()}
            </Text>
          )}
        </If>
        <Each of={normal()} key={(i: DropdownItem) => i.id}>
          {(item) => <DropdownRow item={item()} onPress={() => pick(item())} />}
        </Each>
        <If when={danger().length > 0 && normal().length > 0}>
          <View class="mx-3 my-1.5 h-px bg-white/10" />
        </If>
        <Each of={danger()} key={(i: DropdownItem) => i.id}>
          {(item) => <DropdownRow item={item()} onPress={() => pick(item())} />}
        </Each>
      </View>
    </Popover>
  );
}

function DropdownRow(props: { item: DropdownItem; onPress: () => void }) {
  const danger = () => props.item.tone === "danger";
  return (
    <View
      role="menuitem"
      testID={`menu-${props.item.id}`}
      onPress={props.onPress}
      class={`mx-1.5 flex-row items-center gap-3 rounded-xl px-3 py-2.5 ${danger() ? "active:bg-destructive/15" : "active:bg-accent"}`}
    >
      <If when={props.item.icon}>
        {(icon) => <Text class={`w-6 text-center text-base ${danger() ? "text-destructive" : "text-foreground"}`}>{icon()}</Text>}
      </If>
      <View class="flex-1">
        <Text class={`text-[15px] font-medium ${danger() ? "text-destructive" : "text-popover-foreground"}`}>{props.item.label}</Text>
        <If when={props.item.hint}>{(h) => <Text class="text-xs text-muted-foreground">{h()}</Text>}</If>
      </View>
    </View>
  );
}

/** The round ⋯ button menus open from. */
export function MoreButton(props: { onPress?: () => void; testID?: string; class?: string }) {
  return (
    <View
      role="button"
      accessibilityLabel="More actions"
      testID={props.testID}
      onPress={props.onPress}
      class={`h-9 w-9 items-center justify-center rounded-full bg-black/30 active:bg-black/50 ${props.class ?? ""}`}
    >
      <Text class="text-lg leading-none text-white/90">⋯</Text>
    </View>
  );
}
