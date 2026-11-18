import { type ComponentRef, type Ref, useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  Platform,
  type StyleProp,
  TextInput,
  type TextInputProps,
  type TextStyle,
  useWindowDimensions,
} from "react-native";

import { grownHeight } from "../lib/autoGrow";

type Input = ComponentRef<typeof TextInput>;

/**
 * A multiline text box that grows with what is typed, from `minHeight` to `maxHeight`, then scrolls inside.
 *
 * In a browser the textarea is sized from its own `scrollHeight` in a layout effect, and nothing measured goes
 * through React state: feeding a measured height back into a handler that re-runs on every render shrinks the
 * box a border's width per render until React gives up ("Maximum update depth exceeded") and the app blanks.
 * On iPhone the native view reports its content size only when it changes, so one state value is enough.
 *
 * `onSubmit` is ⌘↩ / Ctrl+↩ on a keyboard (plain Enter stays a new line).
 */
export function AutoGrowInput({
  minHeight = 44,
  maxHeight = 160,
  onSubmit,
  style,
  focusedStyle,
  ref,
  onKeyPress,
  onFocus,
  onBlur,
  ...props
}: Omit<TextInputProps, "multiline" | "onContentSizeChange" | "style"> & {
  minHeight?: number;
  maxHeight?: number;
  onSubmit?: () => void;
  style?: StyleProp<TextStyle>;
  /** Added while the box has the focus (the border in the theme's blue, as `Field` does). */
  focusedStyle?: StyleProp<TextStyle>;
  ref?: Ref<Input>;
}) {
  const [focused, setFocused] = useState(false);
  const web = Platform.OS === "web";
  const node = useRef<Input | null>(null);
  const setNode = useCallback(
    (value: Input | null) => {
      node.current = value;
      if (typeof ref === "function") ref(value);
      else if (ref) ref.current = value;
    },
    [ref],
  );
  // A different width wraps the text differently, so measure again.
  const { width } = useWindowDimensions();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the text and the width are what change the height.
  useLayoutEffect(() => {
    if (!web) return;
    const area = node.current as unknown as HTMLTextAreaElement | null;
    if (!area?.style) return;
    // Collapse first, so `scrollHeight` is the text's height rather than the box's current one.
    area.style.height = "0px";
    const next = grownHeight(area.scrollHeight, area.offsetHeight - area.clientHeight, minHeight, maxHeight);
    area.style.height = `${next.height}px`;
    // No scrollbar until the text is taller than the box: one appearing early would narrow the text.
    area.style.overflowY = next.scrolls ? "auto" : "hidden";
  }, [web, props.value, width, minHeight, maxHeight]);

  const [height, setHeight] = useState(minHeight);
  const grow = useCallback(
    (event: { nativeEvent: { contentSize: { height: number } } }) =>
      setHeight(grownHeight(event.nativeEvent.contentSize.height, 0, minHeight, maxHeight).height),
    [minHeight, maxHeight],
  );
  // An emptied box (sent, or discarded) goes back to its smallest size at once.
  const empty = !props.value;
  return (
    <TextInput
      {...props}
      ref={setNode}
      multiline
      style={[
        style,
        focused && focusedStyle,
        { minHeight, maxHeight },
        !web && { height: empty ? minHeight : height },
      ]}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      onContentSizeChange={web ? undefined : grow}
      onKeyPress={
        onSubmit && web
          ? (event) => {
              onKeyPress?.(event);
              const key = event.nativeEvent as unknown as {
                key: string;
                metaKey?: boolean;
                ctrlKey?: boolean;
              };
              if (key.key === "Enter" && (key.metaKey || key.ctrlKey)) {
                event.preventDefault();
                onSubmit();
              }
            }
          : onKeyPress
      }
    />
  );
}
