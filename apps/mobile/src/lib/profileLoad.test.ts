import { describe, expect, it } from "vitest";
import { createProfileLoader, type ProfileState } from "./profileLoad";

type Profile = { id: string; name: string };

/** A loader whose fetches wait until the test answers them, in any order. */
function setup() {
  const pending: { resolve: (p: Profile) => void; reject: (e: Error) => void }[] = [];
  const states: ProfileState<Profile>[] = [];
  const loader = createProfileLoader<Profile>({
    fetch: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    publish: (state) => states.push(state),
    messageOf: (error) => (error instanceof Error ? error.message : "failed"),
  });
  return { loader, pending, states, now: () => loader.current() };
}
const pat = (name = "Pat"): Profile => ({ id: "pat", name });

describe("profile loading", () => {
  it("starts waiting, and a signed-out start ends the wait", () => {
    const t = setup();
    expect(t.now()).toEqual({ profile: null, loading: true });
    void t.loader.setUser(null);
    expect(t.now()).toEqual({ profile: null, loading: false });
  });

  it("a refresh that answers before the slow first load still ends the wait (the unsubscribe page)", async () => {
    const t = setup();
    const first = t.loader.setUser("pat");
    const refresh = t.loader.refresh();
    expect(t.pending).toHaveLength(2);
    t.pending[1]?.resolve(pat("Pat (fresh)"));
    await refresh;
    expect(t.now()).toEqual({ profile: pat("Pat (fresh)"), loading: false });
    // The first load's older answer doesn't overwrite the newer one, and nothing waits again.
    t.pending[0]?.resolve(pat("Pat (old)"));
    await first;
    expect(t.now()).toEqual({ profile: pat("Pat (fresh)"), loading: false });
  });

  it("a first load that answers before the refresh shows both in order", async () => {
    const t = setup();
    const first = t.loader.setUser("pat");
    const refresh = t.loader.refresh();
    t.pending[0]?.resolve(pat("Pat (old)"));
    await first;
    expect(t.now()).toEqual({ profile: pat("Pat (old)"), loading: false });
    t.pending[1]?.resolve(pat("Pat (fresh)"));
    await refresh;
    expect(t.now().profile?.name).toBe("Pat (fresh)");
  });

  it("a failed first load is shown unless a refresh already brought the profile", async () => {
    const t = setup();
    let first = t.loader.setUser("pat");
    t.pending[0]?.reject(new Error("offline"));
    await first;
    expect(t.now()).toEqual({ profile: null, loading: false, error: "offline" });

    const u = setup();
    first = u.loader.setUser("pat");
    const refresh = u.loader.refresh();
    u.pending[1]?.resolve(pat());
    await refresh;
    u.pending[0]?.reject(new Error("offline"));
    await first;
    expect(u.now()).toEqual({ profile: pat(), loading: false });
  });

  it("a refresh after a failed first load recovers; a failed refresh rejects and changes nothing", async () => {
    const t = setup();
    const first = t.loader.setUser("pat");
    t.pending[0]?.reject(new Error("offline"));
    await first;
    const failed = t.loader.refresh();
    t.pending[1]?.reject(new Error("still offline"));
    await expect(failed).rejects.toThrow("still offline");
    expect(t.now().error).toBe("offline");
    const refresh = t.loader.refresh();
    t.pending[2]?.resolve(pat());
    await refresh;
    expect(t.now()).toEqual({ profile: pat(), loading: false });
  });

  it("signing out while the first load or a refresh is in flight drops their answers", async () => {
    const t = setup();
    const first = t.loader.setUser("pat");
    const refresh = t.loader.refresh();
    void t.loader.setUser(null);
    expect(t.now()).toEqual({ profile: null, loading: false });
    t.pending[0]?.resolve(pat());
    t.pending[1]?.resolve(pat());
    await Promise.all([first, refresh]);
    expect(t.now()).toEqual({ profile: null, loading: false });
  });

  it("another account signing in mid-load waits for its own profile only", async () => {
    const t = setup();
    const first = t.loader.setUser("pat");
    const second = t.loader.setUser("sam");
    expect(t.now().loading).toBe(true);
    t.pending[0]?.resolve(pat());
    await first;
    expect(t.now()).toEqual({ profile: null, loading: true });
    t.pending[1]?.resolve({ id: "sam", name: "Sam" });
    await second;
    expect(t.now()).toEqual({ profile: { id: "sam", name: "Sam" }, loading: false });
  });

  it("the same player again keeps the load in flight, keeps a shown profile, and retries a failed one", async () => {
    const t = setup();
    const first = t.loader.setUser("pat");
    void t.loader.setUser("pat");
    expect(t.pending).toHaveLength(1);
    t.pending[0]?.resolve(pat());
    await first;
    const published = t.states.length;
    await t.loader.setUser("pat");
    expect(t.pending).toHaveLength(1);
    expect(t.states).toHaveLength(published);

    const u = setup();
    const failed = u.loader.setUser("pat");
    u.pending[0]?.reject(new Error("offline"));
    await failed;
    const again = u.loader.setUser("pat");
    expect(u.now()).toEqual({ profile: null, loading: true });
    u.pending[1]?.resolve(pat());
    await again;
    expect(u.now()).toEqual({ profile: pat(), loading: false });
  });

  it("a profile for someone else is never shown, and still ends the wait", async () => {
    const t = setup();
    const first = t.loader.setUser("pat");
    t.pending[0]?.resolve({ id: "sam", name: "Sam" });
    await first;
    expect(t.now()).toEqual({ profile: null, loading: false });
  });

  it("reset waits again until the player is known; fail ends it with the error", async () => {
    const t = setup();
    const first = t.loader.setUser("pat");
    t.pending[0]?.resolve(pat());
    await first;
    t.loader.reset();
    expect(t.now()).toEqual({ profile: null, loading: true });
    await expect(t.loader.refresh()).resolves.toBeUndefined();
    t.loader.fail(new Error("POW Pick'em is unavailable."));
    expect(t.now()).toEqual({ profile: null, loading: false, error: "POW Pick'em is unavailable." });
  });

  it("publishes nothing after dispose", async () => {
    const t = setup();
    const first = t.loader.setUser("pat");
    const published = t.states.length;
    t.loader.dispose();
    t.pending[0]?.resolve(pat());
    await first;
    expect(t.states).toHaveLength(published);
  });
});
