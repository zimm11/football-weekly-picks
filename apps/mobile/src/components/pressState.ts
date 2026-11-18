import type { PressableStateCallbackType } from "react-native";
import { colors } from "./theme";

/**
 * What a `Pressable` knows about itself. React Native passes only `pressed`; react-native-web also passes
 * `hovered` (a mouse is over it) and `focused` (it has the focus, from the keyboard or a click). The types
 * declare `pressed` and, through Expo, `hovered`, though the iPhone app never sets it. Read them here so
 * both are always booleans.
 */
export type PressState = { pressed: boolean; hovered: boolean; focused: boolean };

/**
 * Reads the state a `Pressable` hands its `style` and `children` callbacks:
 * `style={(state) => { const { pressed, hovered } = pressState(state); … }}`.
 */
export function pressState(state: PressableStateCallbackType): PressState {
  const web = state as Partial<PressState>;
  return { pressed: state.pressed === true, hovered: web.hovered === true, focused: web.focused === true };
}

/**
 * The fill of a row, ghost button or icon button: `colors.raised` (the hover layer) under the mouse or a
 * finger, else `rest`. A control already filled with `raised` (a secondary button) passes
 * `colors.raisedHover` as `active`.
 */
export function hoverFill(state: PressableStateCallbackType, rest = "transparent", active = colors.raised) {
  const { pressed, hovered } = pressState(state);
  return pressed || hovered ? active : rest;
}

/**
 * Feedback for a control with a solid fill of its own (a primary button, a team button): a little lighter
 * under the mouse, more so while pressed. Nothing at rest, so it can sit last in a style array.
 */
export function pressFade(state: PressableStateCallbackType): { opacity: number } | undefined {
  const { pressed, hovered } = pressState(state);
  return pressed ? { opacity: 0.8 } : hovered ? { opacity: 0.9 } : undefined;
}

/**
 * Feedback for a big choice tile (a team button, the POW, a survivor team, a choice card, a square): it gives a
 * little under a finger or the mouse. Unselected, it takes the `raisedHover` fill on hover and press; selected
 * (already filled with its own color), it fades a touch instead. Nothing at rest, so it can sit last in a
 * style array.
 */
export function pressTile(state: PressableStateCallbackType, selected: boolean) {
  const { pressed, hovered } = pressState(state);
  if (pressed)
    return selected
      ? { transform: [{ scale: 0.97 }], opacity: 0.9 }
      : { transform: [{ scale: 0.97 }], backgroundColor: colors.raisedHover };
  if (hovered) return selected ? { opacity: 0.95 } : { backgroundColor: colors.raisedHover };
  return undefined;
}

/** How faded a disabled control is, and a busy one (its own request is running). */
export const disabledOpacity = 0.45;
export const busyOpacity = 0.7;

/**
 * Draws the web's keyboard focus ring (`:focus-visible` in `public/boot.css`) just inside the control instead
 * of around it. For a control that sits flush inside a clipped container (a row in a card with
 * `overflow: "hidden"`, an item in a menu), where a ring drawn outside would be cut off. Nothing on iPhone.
 */
export const ringInside = { outlineOffset: -2 } as const;

/**
 * The props that switch a button off, for `disabled` and for `busy` (its own request is running, "Saving…").
 * A busy button looks disabled and ignores presses, but in a browser it must stay a real, enabled button: a
 * disabled one loses the keyboard focus to the page. There it is marked `aria-busy` only, and the caller
 * drops `onPress` while busy. On iPhone, where nothing holds a focus, busy is plain disabled.
 */
export function busyProps(disabled: boolean | undefined, busy: boolean, web: boolean) {
  const off = !!disabled || busy;
  return {
    accessibilityState: { disabled: off, busy },
    "aria-busy": busy || undefined,
    disabled: web ? !!disabled : off,
  };
}

/** What a busy control shows whatever the mouse does: no hover, no press. */
export const atRest: PressState = { pressed: false, hovered: false, focused: false };
