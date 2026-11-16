import { expect, test } from "./fixtures";

test("players can find device notification settings and iPhone installation help", async ({
  page,
  signedIn,
  isMobile,
}) => {
  await page.getByRole("link", { name: "Notifications & pick reminders" }).click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Notifications on this device" })).toBeVisible();
  if (isMobile) {
    await expect(page.getByRole("heading", { name: "iPhone or iPad · Safari" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Enable notifications", exact: true })).toHaveCount(0);
  } else {
    await expect(
      page.getByText("Notifications aren't available yet. Please check back later."),
    ).toBeVisible();
  }
  await page.reload();
  await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
  await page.getByRole("button", { name: signedIn.displayName }).click();
  await page.getByRole("menuitem", { name: "Notifications", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
});

test("a player enables notifications, saves device preferences and turns them off", async ({
  page,
  signedIn,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "iOS permission prompts require an installed app on a physical device.",
  );
  await expect(page.getByRole("button", { name: signedIn.displayName })).toBeVisible();
  // Replace only the OS push boundary and device API; real delivery/ownership are covered by DB API tests.
  await page.addInitScript(() => {
    let subscribed = false;
    const subscription = {
      endpoint: "https://web.push.apple.com/e2e-placeholder",
      toJSON: () => ({
        endpoint: "https://web.push.apple.com/e2e-placeholder",
        keys: { p256dh: `B${"a".repeat(86)}`, auth: "a".repeat(22) },
      }),
      unsubscribe: async () => {
        subscribed = false;
        return true;
      },
    };
    const browser = globalThis as unknown as {
      Notification: { requestPermission: () => Promise<string> };
      PushManager: {
        prototype: {
          getSubscription: () => Promise<typeof subscription | null>;
          subscribe: () => Promise<typeof subscription>;
        };
      };
    };
    let permission = "default";
    Object.defineProperty(browser.Notification, "permission", { configurable: true, get: () => permission });
    browser.Notification.requestPermission = async () => {
      permission = "granted";
      return permission;
    };
    browser.PushManager.prototype.getSubscription = async () => (subscribed ? subscription : null);
    browser.PushManager.prototype.subscribe = async () => {
      subscribed = true;
      return subscription;
    };
  });
  let device: { id: string; newThreads: boolean; pickReminders: boolean } | null = null;
  await page.route("**/api/push/config", (route) =>
    route.fulfill({ json: { configured: true, publicKey: `B${"a".repeat(86)}` } }),
  );
  await page.route("**/api/push/device", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      device = {
        id: "11111111-1111-4111-8111-111111111111",
        newThreads: body.newThreads,
        pickReminders: body.pickReminders,
      };
    } else if (route.request().method() === "DELETE") device = null;
    await route.fulfill({ json: { device, ok: true } });
  });
  await page.goto("/notifications");
  await page.getByRole("button", { name: "Enable notifications", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Notifications are on for this device." }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: "New league threads" }).uncheck();
  await page.getByRole("link", { name: "POW Pick'em", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "New league threads" })).not.toBeChecked();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByRole("button", { name: "Save preferences" })).toBeDisabled();
  expect(device).toMatchObject({ newThreads: false, pickReminders: true });
  await page.getByRole("button", { name: "Turn off on this device" }).click();
  await expect(page.getByRole("button", { name: "Enable notifications", exact: true })).toBeVisible();
  expect(device).toBeNull();
});
