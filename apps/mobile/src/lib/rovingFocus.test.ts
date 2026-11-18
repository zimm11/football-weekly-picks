import { expect, test } from "vitest";
import { rovingTarget } from "./rovingFocus";

const all = [true, true, true];

test("arrow keys step through the items and wrap around", () => {
  expect(rovingTarget("ArrowDown", 0, all)).toBe(1);
  expect(rovingTarget("ArrowRight", 1, all)).toBe(2);
  expect(rovingTarget("ArrowDown", 2, all)).toBe(0);
  expect(rovingTarget("ArrowUp", 0, all)).toBe(2);
  expect(rovingTarget("ArrowLeft", 2, all)).toBe(1);
});

test("Home and End jump to the first and last items that can take focus", () => {
  expect(rovingTarget("Home", 2, all)).toBe(0);
  expect(rovingTarget("End", 0, all)).toBe(2);
  expect(rovingTarget("Home", 2, [false, true, true])).toBe(1);
  expect(rovingTarget("End", 0, [true, true, false])).toBe(1);
});

test("disabled items are skipped", () => {
  expect(rovingTarget("ArrowDown", 0, [true, false, true])).toBe(2);
  expect(rovingTarget("ArrowUp", 0, [true, false, false, true])).toBe(3);
  expect(rovingTarget("ArrowDown", 2, [false, true, true])).toBe(1);
});

test("from outside the list, Down lands on the first item and Up on the last", () => {
  expect(rovingTarget("ArrowDown", -1, all)).toBe(0);
  expect(rovingTarget("ArrowUp", -1, all)).toBe(2);
  expect(rovingTarget("ArrowUp", -1, [true, true, false])).toBe(1);
});

test("other keys, an only item and an all-disabled list go nowhere", () => {
  expect(rovingTarget("Enter", 0, all)).toBeUndefined();
  expect(rovingTarget("a", 0, all)).toBeUndefined();
  expect(rovingTarget("ArrowDown", 0, [true])).toBeUndefined();
  expect(rovingTarget("ArrowDown", 0, [false, false])).toBeUndefined();
  expect(rovingTarget("Home", 0, [])).toBeUndefined();
});
