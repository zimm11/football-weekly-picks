import { expect, test, vi } from "vitest";
import { createOverlayStack } from "./overlayStack";

test("Back closes the top-most overlay first, one per call", () => {
  const stack = createOverlayStack();
  const closed: string[] = [];
  stack.open(() => closed.push("sheet"));
  stack.open(() => closed.push("menu"));
  expect(stack.size).toBe(2);
  expect(stack.closeTop()).toBe(true);
  expect(closed).toEqual(["menu"]);
  expect(stack.size).toBe(1);
  expect(stack.closeTop()).toBe(true);
  expect(closed).toEqual(["menu", "sheet"]);
  expect(stack.closeTop()).toBe(false);
});

test("an overlay is off the stack as soon as Back closes it, and hears that it was taken", () => {
  const stack = createOverlayStack();
  const taken = vi.fn();
  const remove = stack.open(() => {}, taken);
  stack.closeTop();
  expect(taken).toHaveBeenCalledOnce();
  expect(stack.size).toBe(0);
  // Its own cleanup afterwards (the re-render that unmounts it) changes nothing.
  remove();
  expect(stack.size).toBe(0);
});

test("an overlay that closes or unmounts by itself leaves the others in place", () => {
  const stack = createOverlayStack();
  const closed: string[] = [];
  stack.open(() => closed.push("sheet"));
  const removeMenu = stack.open(() => closed.push("menu"));
  stack.open(() => closed.push("dialog"));
  removeMenu();
  expect(stack.size).toBe(2);
  stack.closeTop();
  stack.closeTop();
  expect(closed).toEqual(["dialog", "sheet"]);
});

test("closeAll closes every overlay, the top first", () => {
  const stack = createOverlayStack();
  const closed: string[] = [];
  stack.open(() => closed.push("sheet"));
  stack.open(() => closed.push("menu"));
  stack.closeAll();
  expect(closed).toEqual(["menu", "sheet"]);
  expect(stack.size).toBe(0);
});
