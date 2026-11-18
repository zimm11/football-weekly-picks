import {
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  test as base,
  expect,
  type Page,
} from "@playwright/test";

const PASSWORD = "password123";

/** Creates an account from the sign-in form on the current page and chooses a display name. */
export async function signUp(page: Page, displayName: string) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Display name").fill(displayName);
  // The first name step confirms the player's age and agrees to the Terms of use, which posting needs.
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
  await page.getByRole("checkbox", { name: "I'm 18 or older and I agree to the Terms of use" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  // The account menu sits under the player's name.
  await expect(page.getByRole("button", { name: displayName, exact: true })).toBeVisible();
  return { email, password: PASSWORD, displayName };
}

/** From Your leagues, opens the New league form. */
export async function openNewLeague(page: Page) {
  await page.getByRole("link", { name: "New league" }).click();
  await expect(page.getByRole("heading", { name: "New league" })).toBeVisible();
}

/**
 * Signs out from the account menu and waits for the menu to be gone. Typing into the sign-in form while the
 * menu is still closing can lose the text: the closing menu takes the focus back (seen on WebKit under load).
 */
export async function signOut(page: Page, displayName: string) {
  await page.getByRole("button", { name: displayName, exact: true }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
}

/**
 * A second player in their own browser: opens the invite link signed out, signs up from it and joins. Lands on
 * the league's first tab. Close the returned context when the test is done with the player.
 */
export async function joinLeague(browser: Browser, inviteUrl: string, displayName: string) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(inviteUrl);
    const account = await signUp(page, displayName);
    await page.getByRole("button", { name: "Join league" }).click();
    await expect(page).toHaveURL(/\/leagues\/[^/]+$/);
    return { context, page, account };
  } catch (error) {
    await context.close();
    throw error;
  }
}

/** A `datetime-local` value some days away (read in the league's time zone): ahead to pick, behind to be locked. */
export function kickoffInDays(days: number) {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T13:00`;
}

/**
 * After an action that suggests the home screen (the first saved picks, the first claimed square): on a phone
 * the sheet opens once and is put away with "Not now"; on a computer it never opens. Call it once the action's
 * own outcome is on screen, so "never opens" is checked after the save, not before it.
 */
export async function dismissHomeScreenOffer(page: Page, description = /^Picks saved\./) {
  const offer = page.getByRole("dialog", { name: "Add it to your home screen" });
  if (test.info().project.name !== "mobile-safari") {
    await expect(offer).toHaveCount(0);
    return;
  }
  await expect(offer).toHaveAccessibleDescription(description);
  await expect(offer.getByRole("heading", { name: "iPhone or iPad · Safari" })).toBeVisible();
  await expect(offer.getByRole("heading", { name: "Android · Chrome" })).toHaveCount(0);
  await offer.getByRole("button", { name: "Not now" }).click();
  await expect(offer).toHaveCount(0);
}

/**
 * Playwright's WebKit on macOS (1.65.1, WebKit 2388, seen on macOS 27.2) wedges once one browser has opened
 * about nine contexts: the next navigation never sends its request and the browser dies, so `goto`, `reload`
 * and `context.close` time out. Many pages in one context, or a fresh browser, are fine; CI (Linux) never hits it.
 * Each worker reuses one browser and every test (and each extra player's `browser.newContext()`) opens a
 * context, so a Mac's mobile-safari tests failed by the handful.
 */
const CONTEXTS_PER_BROWSER = 6;

/**
 * On a Mac, the WebKit `browser` stands in for a fresh browser every few contexts. Launches reuse the
 * project's launch options (the loopback-only proxy included) and contexts its context options, as before.
 * Remove once Playwright's WebKit no longer wedges.
 */
function recyclingBrowser(first: Browser, launch: () => Promise<Browser>) {
  let current = first;
  let opened = 0;
  const all = [first];
  const live = new Map<Browser, number>([[first, 0]]);
  // A replaced browser closes once its last context has.
  const release = (owner: Browser) => {
    const left = (live.get(owner) ?? 1) - 1;
    live.set(owner, left);
    if (left === 0 && owner !== current) void owner.close().catch(() => {});
  };
  const newContext = async (options?: BrowserContextOptions): Promise<BrowserContext> => {
    if (opened >= CONTEXTS_PER_BROWSER) {
      const old = current;
      current = await launch();
      all.push(current);
      live.set(current, 0);
      opened = 0;
      if (!live.get(old)) void old.close().catch(() => {});
    }
    opened++;
    const owner = current;
    live.set(owner, (live.get(owner) ?? 0) + 1);
    const context = await owner.newContext(options);
    context.once("close", () => release(owner));
    return context;
  };
  const proxy = new Proxy(first, {
    get(_, key) {
      if (key === "newContext") return newContext;
      const value = Reflect.get(current, key);
      return typeof value === "function" ? value.bind(current) : value;
    },
  });
  return { proxy, closeAll: () => Promise.all(all.map((b) => b.close().catch(() => {}))) };
}

/** Signs up a fresh user per test (local Supabase has email confirmation off), so tests never share state. */
export const test = base.extend<
  { signedIn: { email: string; password: string; displayName: string } },
  { browser: Browser }
>({
  browser: [
    async ({ browser, browserName, playwright }, use) => {
      if (browserName !== "webkit" || process.platform !== "darwin") return use(browser);
      const recycled = recyclingBrowser(browser, () => playwright.webkit.launch());
      await use(recycled.proxy);
      await recycled.closeAll();
    },
    { scope: "worker", timeout: 0 },
  ],
  signedIn: async ({ page }, use) => {
    await page.goto("/");
    await use(await signUp(page, "Commish"));
  },
});

export { expect };
