import { expect, test } from "vitest";
import { createHistoryOrder, entryIdOf } from "./historyOrder";

const at = (id: string) => ({ id });

test("an entry pushed later lies forward of the one it was pushed from", () => {
  const order = createHistoryOrder();
  order.wrote("replace", null, at("a"));
  order.wrote("push", at("a"), at("b"));
  order.wrote("push", at("b"), at("c"));
  expect(order.isForward(at("a"), at("b"))).toBe(true);
  expect(order.isForward(at("c"), at("b"))).toBe(false);
  expect(order.isForward(at("c"), at("a"))).toBe(false);
});

test("a replaced entry keeps its place", () => {
  const order = createHistoryOrder();
  order.wrote("push", null, at("a"));
  order.wrote("push", at("a"), at("b"));
  order.wrote("replace", at("b"), at("b2"));
  expect(order.isForward(at("a"), at("b2"))).toBe(true);
  expect(order.isForward(at("b2"), at("a"))).toBe(false);
});

test("a push after going back lies forward of everything before it", () => {
  const order = createHistoryOrder();
  order.wrote("push", null, at("a"));
  order.wrote("push", at("a"), at("b"));
  // Back to a, then a new link: b is gone from the browser's history, and c is ahead of a.
  order.wrote("push", at("a"), at("c"));
  expect(order.isForward(at("a"), at("c"))).toBe(true);
});

test("entries it never saw written (from before a reload) count as Back", () => {
  const order = createHistoryOrder();
  order.wrote("push", null, at("a"));
  expect(order.isForward(at("a"), at("old"))).toBe(false);
  expect(order.isForward(at("old"), at("a"))).toBe(false);
  expect(order.isForward(null, at("a"))).toBe(false);
});

test("re-pushing an entry already known keeps its place", () => {
  const order = createHistoryOrder();
  order.wrote("push", null, at("a"));
  order.wrote("push", at("a"), at("b"));
  order.wrote("push", at("a"), at("b"));
  expect(order.isForward(at("b"), at("a"))).toBe(false);
});

test("the router's id is read from the state, if there is one", () => {
  expect(entryIdOf({ id: "x" })).toBe("x");
  expect(entryIdOf({ id: 3 })).toBeUndefined();
  expect(entryIdOf(null)).toBeUndefined();
});
