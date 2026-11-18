import { type ComponentRef, type RefObject, useEffect, useState } from "react";
import { Platform, type TextInput, useWindowDimensions } from "react-native";

/**
 * Puts the cursor in a form's first field when its page opens in a browser at desktop width (768px and up), so
 * the player can type at once. Never on phones, where a focused field pops the keyboard over the page. Decided
 * once, when the page opens; `enabled` false leaves the focus alone.
 */
export function useDesktopFocus(ref: RefObject<ComponentRef<typeof TextInput> | null>, enabled = true) {
  const { width } = useWindowDimensions();
  const [focus] = useState(enabled && Platform.OS === "web" && width >= 768);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus, ref]);
}
