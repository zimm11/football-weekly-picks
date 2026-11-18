import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_SPIN_MS, settled } from "./pullRefresh";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("settled", () => {
  it("waits for the reload, then for the rest of the shortest spin", async () => {
    let finish: () => void = () => {};
    const reload = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let done = false;
    void settled(reload, Date.now()).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(MIN_SPIN_MS * 3);
    expect(done).toBe(false);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });

  it("keeps a reload that answered at once spinning for the shortest spin", async () => {
    let done = false;
    void settled(undefined, Date.now()).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(MIN_SPIN_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it("ends when the reload fails, without throwing", async () => {
    let done = false;
    void settled(Promise.reject(new Error("offline")), Date.now() - MIN_SPIN_MS).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });
});
