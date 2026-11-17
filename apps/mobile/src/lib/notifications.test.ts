import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  store: new Map<string, string>(),
  userId: "player-a",
  token: "ExpoPushToken[new-device]",
  request: vi.fn(),
  permission: vi.fn(),
  ask: vi.fn(),
  getToken: vi.fn(),
}));
vi.mock("expo-constants", () => ({
  default: { appOwnership: "standalone", easConfig: { projectId: "11111111-1111-4111-8111-111111111111" } },
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (key: string) => mocks.store.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    mocks.store.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    mocks.store.delete(key);
  }),
}));
vi.mock("expo-notifications", () => ({
  getPermissionsAsync: mocks.permission,
  requestPermissionsAsync: mocks.ask,
  getExpoPushTokenAsync: mocks.getToken,
  setNotificationHandler: vi.fn(),
  DEFAULT_ACTION_IDENTIFIER: "default",
}));
vi.mock("./api", () => ({
  request: mocks.request,
  getSupabase: async () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: mocks.userId } } } }) },
  }),
}));

import { disableNativePush, enableNativePush, reconcileNativePush } from "./notifications";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.store.clear();
  mocks.userId = "player-a";
  mocks.permission.mockResolvedValue({ granted: true, status: "granted" });
  mocks.getToken.mockImplementation(async () => ({ data: mocks.token }));
  mocks.request.mockImplementation(
    async (path: string, options?: { body?: { newThreads?: boolean; pickReminders?: boolean } }) => {
      if (path.endsWith("config")) return { configured: true };
      return {
        device: {
          id: "device-id",
          newThreads: options?.body?.newThreads ?? true,
          pickReminders: options?.body?.pickReminders ?? true,
        },
      };
    },
  );
});
describe("native push ownership and rotation", () => {
  it("disconnects the opted-in token before removing its local owner", async () => {
    await enableNativePush({ newThreads: true, pickReminders: false }, "player-a");
    await disableNativePush();
    expect(mocks.request).toHaveBeenLastCalledWith("/push/native/device", {
      method: "DELETE",
      body: { token: mocks.token },
    });
    expect(mocks.store.size).toBe(0);
  });
  it("keeps owner metadata when disconnect fails so sign-out can be retried safely", async () => {
    await enableNativePush({ newThreads: true, pickReminders: true }, "player-a");
    mocks.request.mockRejectedValueOnce(new Error("offline"));
    await expect(disableNativePush()).rejects.toThrow("offline");
    expect(mocks.store.size).toBe(1);
  });
  it("never transfers a previous account's subscription to the current account", async () => {
    await enableNativePush({ newThreads: true, pickReminders: true }, "player-a");
    mocks.userId = "player-b";
    mocks.request.mockClear();
    await expect(enableNativePush({ newThreads: true, pickReminders: true }, "player-b")).rejects.toThrow(
      "another account",
    );
    expect(mocks.request.mock.calls.filter((call) => call[1]?.method === "PUT")).toHaveLength(0);
  });
  it("rotates only an already opted-in token and preserves its device preferences", async () => {
    await enableNativePush({ newThreads: false, pickReminders: true }, "player-a");
    const oldToken = mocks.token;
    mocks.getToken.mockResolvedValueOnce({ data: "ExpoPushToken[replacement]" });
    await reconcileNativePush("player-a");
    expect(mocks.request).toHaveBeenLastCalledWith("/push/native/device", {
      method: "PUT",
      body: { token: "ExpoPushToken[replacement]", oldToken, newThreads: false, pickReminders: true },
    });
    expect(mocks.ask).not.toHaveBeenCalled();
  });
  it("does not register or prompt during reconciliation before opt-in", async () => {
    await reconcileNativePush("player-a");
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.getToken).not.toHaveBeenCalled();
    expect(mocks.ask).not.toHaveBeenCalled();
  });
});
