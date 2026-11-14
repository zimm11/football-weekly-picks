import { expect, test } from "./fixtures";

const inboxUrl = () => {
  const url = process.env.INBOX_URL;
  if (!url) throw new Error("E2E requires INBOX_URL. Run pnpm env:local first.");
  return url;
};

/** Waits for the newest email to `to` in the local test inbox and returns the link it carries. */
async function resetLinkFor(to: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const search = await fetch(`${inboxUrl()}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
        const { messages } = (await search.json()) as { messages: { ID: string }[] };
        const [newest] = messages;
        if (!newest) return undefined;
        const message = await fetch(`${inboxUrl()}/api/v1/message/${newest.ID}`);
        const { HTML, Text } = (await message.json()) as { HTML: string; Text: string };
        link =
          /href="([^"]*\/auth\/v1\/verify[^"]*)"/.exec(HTML)?.[1] ??
          /(http\S+\/auth\/v1\/verify\S+)/.exec(Text)?.[1];
        return link;
      },
      { message: "reset email arrives", timeout: 15_000 },
    )
    .toBeTruthy();
  return (link as string).replaceAll("&amp;", "&");
}

test("a player who forgot their password can reset it from an emailed link", async ({ page, signedIn }) => {
  await page.getByRole("button", { name: signedIn.displayName }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();

  await page.getByLabel("Email").fill(signedIn.email);
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByLabel("Email")).toHaveValue(signedIn.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status").filter({ hasText: "a reset link is on its way" })).toBeVisible();

  await page.goto(await resetLinkFor(signedIn.email));
  await expect(page).toHaveURL(/\/reset-password/);
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  const newPassword = "brand-new-pass9";
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByLabel("Confirm new password").fill(newPassword);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByText("Password updated.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your leagues" })).toBeVisible();

  // The old password no longer works; the new one does.
  await page.getByRole("button", { name: signedIn.displayName }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.getByLabel("Email").fill(signedIn.email);
  await page.getByLabel("Password").fill(signedIn.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByLabel("Password").fill(newPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: signedIn.displayName })).toBeVisible();
});

test("an expired reset link explains itself and offers a new one", async ({ page }) => {
  await page.goto(
    "/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
  );
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("expired");
  await expect(page.getByRole("button", { name: "Send reset link" })).toBeVisible();
});

test("a signed-in player can change their password from the account menu", async ({ page, signedIn }) => {
  await page.getByRole("button", { name: signedIn.displayName }).click();
  await page.getByRole("menuitem", { name: "Change password" }).click();
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Your leagues" })).toBeVisible();
});
