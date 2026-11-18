import { describe, expect, it } from "vitest";
import { opensKeyboard } from "./softKeyboardField";

describe("opensKeyboard", () => {
  it("is true for text fields", () => {
    expect(opensKeyboard({ tagName: "TEXTAREA" })).toBe(true);
    expect(opensKeyboard({ tagName: "INPUT" })).toBe(true);
    expect(opensKeyboard({ tagName: "INPUT", type: "email" })).toBe(true);
    expect(opensKeyboard({ tagName: "INPUT", type: "password" })).toBe(true);
    expect(opensKeyboard({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("is false for pickers, toggles, buttons and fields that can't be typed in", () => {
    expect(opensKeyboard(null)).toBe(false);
    expect(opensKeyboard({ tagName: "BUTTON" })).toBe(false);
    expect(opensKeyboard({ tagName: "SELECT" })).toBe(false);
    expect(opensKeyboard({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(opensKeyboard({ tagName: "INPUT", type: "datetime-local" })).toBe(false);
    expect(opensKeyboard({ tagName: "TEXTAREA", readOnly: true })).toBe(false);
    expect(opensKeyboard({ tagName: "INPUT", disabled: true })).toBe(false);
    expect(opensKeyboard({ tagName: "DIV" })).toBe(false);
  });
});
