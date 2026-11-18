import type { PressableStateCallbackType } from "react-native";
import { expect, test } from "vitest";
import { busyProps, hoverFill, pressFade, pressState } from "./pressState";
import { colors } from "./theme";

// react-native-web passes all three; the iPhone app passes only `pressed`.
const web = (state: { pressed?: boolean; hovered?: boolean; focused?: boolean }) =>
  ({ pressed: false, ...state }) as PressableStateCallbackType;
const native = (pressed: boolean) => ({ pressed }) as PressableStateCallbackType;

test("pressState reads hovered and focused where the platform passes them, false elsewhere", () => {
  expect(pressState(native(true))).toEqual({ pressed: true, hovered: false, focused: false });
  expect(pressState(web({ hovered: true, focused: true }))).toEqual({
    pressed: false,
    hovered: true,
    focused: true,
  });
});

test("hoverFill is the raised layer under the mouse or a finger, else the resting fill", () => {
  expect(hoverFill(web({}))).toBe("transparent");
  expect(hoverFill(web({}), colors.card)).toBe(colors.card);
  expect(hoverFill(web({ hovered: true }), colors.card)).toBe(colors.raised);
  expect(hoverFill(native(true))).toBe(colors.raised);
  expect(hoverFill(web({ hovered: true }), colors.raised, colors.raisedHover)).toBe(colors.raisedHover);
});

test("pressFade dims a filled control a little on hover, more while pressed, and not at rest", () => {
  expect(pressFade(web({}))).toBeUndefined();
  expect(pressFade(web({ hovered: true }))).toEqual({ opacity: 0.9 });
  expect(pressFade(web({ hovered: true, pressed: true }))).toEqual({ opacity: 0.8 });
});

test("a busy button is disabled on iPhone but stays enabled, marked busy, in a browser", () => {
  expect(busyProps(false, true, true)).toEqual({
    accessibilityState: { disabled: true, busy: true },
    "aria-busy": true,
    disabled: false,
  });
  expect(busyProps(undefined, true, false).disabled).toBe(true);
  expect(busyProps(true, false, true)).toEqual({
    accessibilityState: { disabled: true, busy: false },
    "aria-busy": undefined,
    disabled: true,
  });
  expect(busyProps(undefined, false, true).disabled).toBe(false);
});
