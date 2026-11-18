import { expect, test } from "vitest";
import { fieldDefaults } from "./fieldProps";

test("a plain field gets no defaults", () => {
  expect(fieldDefaults({ submits: false }, true)).toEqual({});
  expect(fieldDefaults({ submits: false }, false)).toEqual({});
});

test("a password field never capitalizes, autocorrects or spell-checks", () => {
  expect(fieldDefaults({ submits: false, secureTextEntry: true }, true)).toEqual({
    autoCapitalize: "none",
    autoCorrect: false,
    spellCheck: false,
  });
});

test("a field that submits says done on the return key and keeps the focus in a browser", () => {
  expect(fieldDefaults({ submits: true }, true)).toEqual({ enterKeyHint: "done", blurOnSubmit: false });
  expect(fieldDefaults({ submits: true }, false)).toEqual({ enterKeyHint: "done" });
});

test("the caller's return key label is kept, and next keeps the iPhone keyboard up", () => {
  expect(fieldDefaults({ submits: true, enterKeyHint: "go" }, false)).toEqual({});
  expect(fieldDefaults({ submits: true, returnKeyType: "send" }, true)).toEqual({ blurOnSubmit: false });
  expect(fieldDefaults({ submits: true, enterKeyHint: "next" }, false)).toEqual({ submitBehavior: "submit" });
  expect(fieldDefaults({ submits: true, enterKeyHint: "next" }, true)).toEqual({ blurOnSubmit: false });
});

test("a multiline field keeps Enter for new lines", () => {
  expect(fieldDefaults({ submits: true, multiline: true }, true)).toEqual({});
  expect(fieldDefaults({ submits: true, multiline: true }, false)).toEqual({});
});
