import { router } from "expo-router";
import type { ComponentRef, Ref } from "react";
import {
  type GestureResponderEvent,
  Platform,
  Pressable,
  type PressableProps,
  type View,
} from "react-native";
import { confirmDiscard, hasUnsavedWork } from "../lib/unsaved";

/** How a link changes the screen: on top of this one, in its place, or back down to a screen already open. */
export type LinkHow = "push" | "replace" | "dismissTo";

/**
 * Opens an in-app path, asking first when a screen holds unsaved work. Synchronous when nothing is unsaved, so
 * the next screen replaces this one within the tap. Resolves false when the player chose to stay.
 */
export async function openPath(path: string, how: LinkHow = "push") {
  const asked = hasUnsavedWork();
  if (asked && !(await confirmDiscard())) return false;
  // Replacing or dismissing removes this screen, which its own removal guard (`useRemovalGuard`) stops until the
  // discarded draft has re-rendered: give it that turn, or the player is asked a second time.
  if (asked && how !== "push") await new Promise((resolve) => setTimeout(resolve, 0));
  if (how === "replace") router.replace(path as never);
  else if (how === "dismissTo") router.dismissTo(path as never);
  else router.push(path as never);
  return true;
}

/** A click the browser should handle itself: ⌘/Ctrl/Shift-click opens the link in a new tab or window. */
function browserOwns(event: GestureResponderEvent) {
  if (Platform.OS !== "web") return false;
  const click = event as unknown as {
    metaKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    button?: number;
  };
  return !!(click.metaKey || click.ctrlKey || click.shiftKey) || (click.button ?? 0) !== 0;
}

/**
 * A link to another screen of the app. On the web it is a real `<a href>` (react-native-web renders one for a
 * View with `href`), so Enter follows it, the browser shows its address, and it opens in a new tab like any
 * link; a plain click stays in the app and goes through the unsaved-work guard. On iPhone it is a Pressable
 * announced as a link.
 *
 * `onPress` replaces the default navigation (the tab bar skips the tab it is on; Back goes back), and still
 * leaves new-tab clicks to the browser.
 */
export function AppLink({
  href,
  how = "push",
  onPress,
  ref,
  ...props
}: Omit<PressableProps, "onPress"> & {
  href: string;
  how?: LinkHow;
  onPress?: () => void;
  ref?: Ref<ComponentRef<typeof View>>;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      {...props}
      {...(Platform.OS === "web" ? ({ href } as object) : null)}
      ref={ref}
      onPress={(event) => {
        if (browserOwns(event)) return;
        // The app changes the screen itself; without this the browser would load the address as a new page.
        event.preventDefault?.();
        if (onPress) onPress();
        else void openPath(href, how);
      }}
    />
  );
}
