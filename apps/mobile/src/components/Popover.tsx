import {
  type ComponentRef,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type KeyDownEvent,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReducedMotion } from "../lib/motion";
import { rovingTarget } from "../lib/rovingFocus";
import { Backdrop } from "./BottomSheet";
import { Icon, type IconName } from "./Icon";
import { hoverFill, ringInside } from "./pressState";
import { colors, fonts } from "./theme";

/** Lets the chosen item of a long, scrolling list bring itself into view when the list opens. */
const RevealContext = createContext<((y: number) => void) | undefined>(undefined);

/** Where the control that opened a popover sits on screen, from `measureInWindow`. */
export type Anchor = { x: number; y: number; width: number; height: number };

const GAP = 6;
const EDGE = 8;

/** What the arrow keys move between, in a browser: the popover's menu items and choices. */
const ITEMS = '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="radio"]';
/** The popover's items as the browser sees them. Only called on the web. */
function itemsOf(container: unknown) {
  const node = container as HTMLElement | null;
  const all = node ? Array.from(node.querySelectorAll<HTMLElement>(ITEMS)) : [];
  return { all, enabled: all.map((item) => item.getAttribute("aria-disabled") !== "true") };
}

/** A ref for the control that opens a popover, and the popover's open/closed state anchored to it. */
export function useAnchor() {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const [anchor, setAnchor] = useState<Anchor>();
  return {
    ref,
    anchor,
    open: () => ref.current?.measureInWindow((x, y, width, height) => setAnchor({ x, y, width, height })),
    close: () => setAnchor(undefined),
  };
}

/**
 * A small menu pinned to the control that opened it, like a dropdown: below the control,
 * or above when there is no room, and kept inside the screen. Tapping outside closes it.
 *
 * With a keyboard, in a browser: the focus moves to the chosen item, or the first one that can be used, when
 * it opens; the arrow keys, Home and End move between items; Enter picks one; Escape closes and returns the
 * focus to the control that opened it. `menu` says its children are menu items (`MenuItem`, or anything with
 * a `menuitem…` role), so screen readers hear a menu; `Menu` sets it.
 */
export function Popover({
  anchor,
  onClose,
  label,
  align = "start",
  width,
  minWidth,
  maxHeight,
  radius = 16,
  menu = false,
  children,
}: {
  anchor: Anchor | undefined;
  onClose: () => void;
  /** Names the popover's contents for screen readers ("Add reaction"). */
  label: string;
  /** "end" lines its right edge up with the control's, as web's ⋯ menus do. */
  align?: "start" | "end";
  width?: number;
  minWidth?: number;
  /** Long lists (time zones) scroll inside the popover. */
  maxHeight?: number;
  radius?: number;
  /** Its children are menu items: the container is announced as a menu. */
  menu?: boolean;
  children: ReactNode;
}) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [size, setSize] = useState<{ width: number; height: number }>();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const container = useRef<ComponentRef<typeof View>>(null);
  const open = !!anchor;
  // Before the Modal's focus trap looks for somewhere to put the focus, which could be a disabled item: the
  // chosen item, else the first that can be used, else the popover itself.
  useEffect(() => {
    if (!open || Platform.OS !== "web") return;
    const { all, enabled } = itemsOf(container.current);
    const chosen = all.findIndex(
      (item, index) => enabled[index] && item.getAttribute("aria-checked") === "true",
    );
    const target = all[chosen >= 0 ? chosen : enabled.indexOf(true)];
    (target ?? (container.current as unknown as HTMLElement | null))?.focus();
  }, [open]);
  if (!anchor) return null;
  function moveFocus(event: KeyDownEvent) {
    const { all, enabled } = itemsOf(container.current);
    const target = rovingTarget(
      event.nativeEvent.key,
      all.indexOf(document.activeElement as HTMLElement),
      enabled,
    );
    if (target === undefined) return;
    event.preventDefault();
    all[target]?.focus();
  }
  // On the web, Modal's own element is the dialog; this names it.
  const dialog = { "aria-label": label } as object;
  const below = anchor.y + anchor.height + GAP;
  const fitsBelow = !size || below + size.height <= screenHeight - insets.bottom - EDGE;
  const top = fitsBelow ? below : Math.max(insets.top + EDGE, anchor.y - GAP - (size?.height ?? 0));
  const preferred = align === "end" ? anchor.x + anchor.width - (size?.width ?? 0) : anchor.x;
  const left = Math.min(Math.max(EDGE, preferred), Math.max(EDGE, screenWidth - (size?.width ?? 0) - EDGE));
  const room = Math.max(
    120,
    (fitsBelow ? screenHeight - insets.bottom - below : anchor.y - insets.top) - EDGE * 2,
  );
  return (
    // No fade in a browser: react-native-web's Modal hears Escape only once its animation has finished.
    <Modal
      transparent
      visible
      animationType={Platform.OS === "web" || reduced ? "none" : "fade"}
      onRequestClose={onClose}
      {...dialog}
    >
      <Backdrop onPress={onClose} />
      <View
        ref={container}
        role={menu ? "menu" : undefined}
        // Focusable from code only (never a Tab stop): where the focus rests when no item can take it.
        tabIndex={-1}
        accessibilityViewIsModal
        accessibilityLabel={label}
        onKeyDown={Platform.OS === "web" ? moveFocus : undefined}
        onLayout={(event) => {
          const { width: w, height: h } = event.nativeEvent.layout;
          if (w !== size?.width || h !== size?.height) setSize({ width: w, height: h });
        }}
        style={{
          position: "absolute",
          top,
          left,
          width,
          minWidth,
          maxWidth: screenWidth - EDGE * 2,
          maxHeight: Math.min(maxHeight ?? Number.POSITIVE_INFINITY, room),
          // Hidden until measured, so it never flashes in the wrong place.
          opacity: size ? 1 : 0,
          backgroundColor: colors.popover,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius,
          padding: 4,
          overflow: "hidden",
          boxShadow: "0 8px 24px #00000066",
        }}
      >
        {maxHeight ? (
          <RevealContext.Provider
            value={(y) => scroll.current?.scrollTo({ y: Math.max(0, y - 88), animated: false })}
          >
            <ScrollView ref={scroll} bounces={false}>
              {children}
            </ScrollView>
          </RevealContext.Provider>
        ) : (
          children
        )}
      </View>
    </Modal>
  );
}

/** A dropdown menu, as web's `DropdownMenu`: at least 176px wide, with 44px rows. */
export function Menu(props: Omit<Parameters<typeof Popover>[0], "minWidth" | "radius" | "menu">) {
  return <Popover minWidth={176} radius={16} menu {...props} />;
}

export function MenuItem({
  label,
  accessibilityLabel,
  icon,
  destructive = false,
  checked,
  disabled = false,
  onPress,
}: {
  label: string;
  /** A full name when the visible label is short ("Remove Pat"). */
  accessibilityLabel?: string;
  icon?: IconName;
  destructive?: boolean;
  /** Set for a choice in a list; the chosen one shows a check. */
  checked?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const ink = destructive ? colors.destructive : colors.foreground;
  const reveal = useContext(RevealContext);
  return (
    <Pressable
      onLayout={checked && reveal ? (event) => reveal(event.nativeEvent.layout.y) : undefined}
      accessibilityRole={checked === undefined ? "menuitem" : "radio"}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled, ...(checked === undefined ? {} : { checked }) }}
      // react-native-web reads only the aria-* form; inside a menu a choice is a "menuitemradio" there.
      aria-checked={checked}
      {...(Platform.OS === "web" && checked !== undefined ? ({ role: "menuitemradio" } as object) : null)}
      disabled={disabled}
      onPress={onPress}
      style={(state) => ({
        minHeight: 44,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        opacity: disabled ? 0.45 : 1,
        backgroundColor: hoverFill(state),
        ...ringInside,
      })}
    >
      {icon && <Icon name={icon} size={20} color={ink} />}
      <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 16, lineHeight: 22, color: ink }}>
        {label}
      </Text>
      {checked && <Icon name="check" size={18} color={colors.primary} weight="bold" />}
    </Pressable>
  );
}
