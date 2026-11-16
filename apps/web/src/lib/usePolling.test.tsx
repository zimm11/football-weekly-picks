import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { usePolling } from "./usePolling";

function Poller({ refresh, enabled = true }: { refresh: () => void; enabled?: boolean }) {
  usePolling(refresh, 1_000, enabled);
  return <p>polling</p>;
}

function setVisibility(state: DocumentVisibilityState) {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("usePolling", () => {
  it("refreshes on a timer, pauses while the tab is hidden, and refreshes on coming back", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    await render(<Poller refresh={refresh} />);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    setVisibility("hidden");
    vi.advanceTimersByTime(10_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    setVisibility("visible");
    expect(refresh).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(1_000);
    expect(refresh).toHaveBeenCalledTimes(4);
  });

  it("does nothing while disabled", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    await render(<Poller refresh={refresh} enabled={false} />);
    vi.advanceTimersByTime(5_000);
    setVisibility("hidden");
    setVisibility("visible");
    expect(refresh).not.toHaveBeenCalled();
  });
});
