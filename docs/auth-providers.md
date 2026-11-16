# Google sign-in

POW Pick'em can offer **Continue with Google** on its sign-in screens, next to email and password. The code ships
switched off: the button appears only when the API's `AUTH_PROVIDERS` setting lists `google`. Google also has to
be set up in Google Cloud and switched on in Supabase Auth. This page lists every setting involved, in the order
to do them.

**Status:** the code is merged and switched off. None of the external setup below has been done yet.

Google is the only provider for now. `AUTH_PROVIDERS` is a list so another (Apple, which the future iOS app will
need) can be added later: add it to `AUTH_PROVIDERS` in `packages/shared/src/index.ts` and to `PROVIDERS` in
`apps/web/src/components/SignInForm.tsx`, then set it up the same way.

## How it works

1. The player taps **Continue with Google**. The web app calls
   `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: <current page> } })`
   (`apps/web/src/App.tsx`).
2. The browser goes to Supabase Auth, which sends it on to Google. Google sends the player back to Supabase's
   callback, `https://<project-ref>.supabase.co/auth/v1/callback`.
3. Supabase creates the user, or signs in an existing one, and redirects to `redirectTo` with the session in the
   URL hash. supabase-js picks it up, and the existing `onAuthStateChange` listener signs the player in.
4. The API needs no change. `requireAuth` verifies the Supabase access token the same way whichever method signed
   the player in, and `auth.users.id` is still the id that profiles, memberships and picks use.

`redirectTo` is the page the player started on, so an invite link (`/join/<code>`) survives the round trip,
as long as the URL is in Supabase's redirect allow-list (see "Supabase Auth" below). If it isn't, Supabase
silently sends the player to the Site URL instead and the invite is lost.

A failed or cancelled sign-in comes back with `error` and `error_description` in the URL. The sign-in form shows
the description, and the app removes those parameters from the address bar.

A new player still picks their leaderboard name on first sign-in. The name form is pre-filled from Google's
`full_name` / `name` (`user_metadata`).

## Checklist

| #   | Where                | What                                                                   |
| --- | -------------------- | ---------------------------------------------------------------------- |
| 1   | Supabase dashboard   | Redirect URLs allow `https://www.pow-pickem.com/**`                    |
| 2   | Google Cloud Console | OAuth consent screen + Web OAuth client                                |
| 3   | Supabase dashboard   | Google provider: client ID + secret                                    |
| 4   | `wrangler.jsonc`     | `"AUTH_PROVIDERS": "google"` in `vars`, merged to main (which deploys) |

## 1. Supabase Auth: URLs

Supabase dashboard → **Authentication → URL Configuration**:

| Setting       | Value                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------- |
| Site URL      | `https://www.pow-pickem.com` (already set for email links; check it)                            |
| Redirect URLs | `https://www.pow-pickem.com/**` (the `**` lets sign-in return to any page, e.g. `/join/<code>`) |

The `/**` entry also covers the `/reset-password` and `/account` redirects the sign-in emails use (README,
"Email"), so it can replace those entries.

The **Callback URL** Google needs is shown on the provider's page in the Supabase dashboard
(Authentication → Sign In / Providers → Google). Without a custom domain it is
`https://<project-ref>.supabase.co/auth/v1/callback`.

### Optional: Supabase custom domain

Without one, Google's account chooser says "to continue to `<project-ref>.supabase.co`", which looks suspicious to
players. A Supabase custom domain (paid add-on), e.g. `auth.pow-pickem.com`, puts your domain there instead. Since
`pow-pickem.com` is on Cloudflare, the CNAME and verification TXT records Supabase asks for go in its DNS (leave
the CNAME **DNS only**, not proxied). If you add one, **the callback URL changes** to
`https://auth.pow-pickem.com/auth/v1/callback`: register that URL with Google (keep the old one during the
switch), and update the Worker's `SUPABASE_URL` secret (`pnpm exec wrangler secret put SUPABASE_URL` from
`apps/api`).

## 2. Google Cloud Console

Use (or create) a Google Cloud project for POW Pick'em.

**Google Auth Platform → Branding / Audience** (formerly "APIs & Services → OAuth consent screen"):

| Setting                | Value                                                                  |
| ---------------------- | ---------------------------------------------------------------------- |
| User type / Audience   | External                                                               |
| App name               | `POW Pick'em`                                                          |
| User support email     | an address you monitor                                                 |
| App logo               | optional; adding one triggers Google brand verification                |
| App home page          | `https://www.pow-pickem.com`                                           |
| Privacy policy / Terms | URLs on the site (needed before publishing; the app has none yet)      |
| Authorized domains     | `pow-pickem.com` and `<project-ref>.supabase.co` (see below)           |
| Scopes                 | `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`       |
| Publishing status      | **In production**. While "Testing", only listed test users can sign in |

These are non-sensitive scopes, so publishing doesn't need Google's security review.

Authorized domains must be "top private domains". `supabase.co` is on the public suffix list, so Google rejects it
("Invalid domain: must be a top private domain"); enter the project's own host, `<project-ref>.supabase.co`,
which the redirect URI below uses. With a Supabase custom domain, `pow-pickem.com` already covers it.

**Google Auth Platform → Clients → Create client** (formerly "Credentials → OAuth client ID"):

| Setting                       | Value                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| Application type              | Web application                                                                            |
| Name                          | `POW Pick'em (Supabase)`                                                                   |
| Authorized JavaScript origins | `https://www.pow-pickem.com`                                                               |
| Authorized redirect URIs      | `https://<project-ref>.supabase.co/auth/v1/callback` (the Supabase callback, not the site) |
| (local dev, optional)         | also `http://127.0.0.1:54321/auth/v1/callback`; see "Local development"                    |

Keep the **Client ID** and **Client secret** for step 3. Store the secret in your password manager; it is never
committed to the repo and never set on the Worker (only Supabase holds it).

## 3. Supabase: Google provider

Supabase dashboard → **Authentication → Sign In / Providers → Google**:

| Setting                      | Value                          |
| ---------------------------- | ------------------------------ |
| Enable Sign in with Google   | on                             |
| Client IDs                   | the Google OAuth Client ID     |
| Client Secret (for OAuth)    | the Google OAuth Client secret |
| Skip nonce checks            | off                            |
| Allow users without an email | off                            |

## 4. Switch the button on (Cloudflare Worker)

`AUTH_PROVIDERS` isn't secret, so it lives in version control. In `apps/api/wrangler.jsonc`, add it to `vars`:

```jsonc
"vars": { "NODE_ENV": "production", "APP_URL": "https://www.pow-pickem.com", "AUTH_PROVIDERS": "google" },
```

Merging to main deploys it (`deploy.yml` runs `wrangler deploy`). The web app reads the list from `/api/config`
at runtime and the web build ships in the same deploy, so nothing else changes. Only `google` is accepted. A Worker
with any other value logs a startup error and answers every API request with a 500, which the deploy's live
health check (`scripts/check-live.mjs`) catches; fix the value, or `wrangler rollback`. Remove `google` from the
list to hide the button again. Existing sessions stay signed in.

Don't set it with `wrangler secret put` or in the dashboard: `wrangler deploy` replaces dashboard vars with the
ones in `wrangler.jsonc`.

Switch Google on in Supabase (step 3) **before** listing it here. Otherwise the button leads to Supabase's
"Unsupported provider" error.

## Accounts and email

- **Same verified email → same account.** Supabase links a Google sign-in to an existing user whose **confirmed**
  email matches. A player who registered `name@gmail.com` with a password and confirmed it keeps one account, with
  their leagues and picks, after switching to Google.
- **Google-only players have no password.** The account screen's **Change password** still works for them: it
  sets a password on the signed-in account, after which email sign-in also works. Relabelling it "Set password"
  for these players (checking `session.user.identities`) is a small follow-up.
- **Changing email** on the account screen changes the Supabase account's email; the Google identity stays linked,
  so **Continue with Google** keeps working with the old Google account.
- **Notification emails** (new threads, pick reminders) go to the account's email, which for a Google player is
  their Gmail or Workspace address. They can turn them off under Account settings, like everyone else.
- Removing a player from a league, and the league's history, work the same whichever sign-in method they use.

## Button design

The button uses the app's `outline` button with the Phosphor Google mark, in keeping with the dark theme and the
44px tap target. Before launch, check it against Google's branding rules
(<https://developers.google.com/identity/branding-guidelines>), which expect the multicolour "G" mark. Swapping
in the official mark is a contained change in `apps/web/src/components/SignInForm.tsx`, and a deliberate
exception to "use the tokens".

## Local development

Google is off in `supabase/config.toml`, so `pnpm db:start` works without any credentials.

**Google locally** (main checkout only, see below):

1. Add `http://127.0.0.1:54321/auth/v1/callback` to the Google OAuth client's redirect URIs (or create a separate
   "local" client).
2. Start Supabase with the provider switched on and its credentials in the environment:

   ```sh
   export SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=<client id>
   export SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=<client secret>
   SUPABASE_AUTH_EXTERNAL_GOOGLE_ENABLED=true pnpm db:start   # or set enabled = true in config.toml, uncommitted
   AUTH_PROVIDERS=google pnpm dev
   ```

   The Supabase CLI reads `SUPABASE_<SECTION>_<KEY>` overrides from the environment; `scripts/ports.mjs` already
   uses this for `SUPABASE_AUTH_SITE_URL`. If an override isn't picked up, flip `enabled` in `config.toml` locally
   instead and don't commit it.

`AUTH_PROVIDERS=google pnpm worker:dev` passes it to the local Worker too. But the Worker serves on
`PORT + 1000`, which isn't in the local redirect allow-list, so after Google the player lands on the Site URL
(the Vite dev server) instead. Test the Google round trip with `pnpm dev`.

**Worktrees:** Google requires each redirect URI to be registered exactly, and each worktree's Supabase listens on
its own port (`54321 + 10n`, from `pnpm ports`). Either test Google in the main checkout only, or register the
callback for each slot you use. The local redirect allow-list (`additional_redirect_urls`) also covers only the
main checkout's web port 5173. In another worktree, the return trip lands on that worktree's Site URL root.

**Tests:** `SignInForm.test.tsx` covers the button (hidden when switched off, busy while redirecting, errors), and
`apps/api/test/app.test.ts` covers parsing `AUTH_PROVIDERS` for both entrypoints. A real Google sign-in can't run
in Playwright, and E2E is limited to local auth services, so E2E doesn't cover it. Check it by hand after each
setup change.

## Future iOS app

- App Store guideline 4.8: an iOS app that offers Google sign-in must also offer Sign in with Apple (or an
  equivalent privacy-focused option), so Apple comes back with the iOS app.
- Native apps use `supabase.auth.signInWithIdToken({ provider: "google", token })` with the ID token from Google's
  iOS SDK. Create an iOS OAuth client in Google Cloud and add its ID to the Supabase Google provider's
  **Client IDs** (comma-separated). Leave "Skip nonce checks" off and pass the nonce from the app.

## Every setting at a glance

| Setting                                               | Where                               | Value / source                                       | Secret?          |
| ----------------------------------------------------- | ----------------------------------- | ---------------------------------------------------- | ---------------- |
| Site URL                                              | Supabase → Auth → URL Configuration | `https://www.pow-pickem.com`                         | no               |
| Redirect URLs                                         | Supabase → Auth → URL Configuration | `https://www.pow-pickem.com/**`                      | no               |
| OAuth consent screen (Branding / Audience)            | Google Cloud → Google Auth Platform | app name, domains, scopes, published                 | no               |
| Google OAuth Client ID                                | Google Cloud → Clients              | → Supabase Google provider                           | no               |
| Google OAuth Client secret                            | Google Cloud → Clients              | → Supabase Google provider                           | **yes**          |
| Google authorized redirect URI                        | Google Cloud → Clients              | `https://<project-ref>.supabase.co/auth/v1/callback` | no               |
| `AUTH_PROVIDERS`                                      | `apps/api/wrangler.jsonc` → `vars`  | `google`                                             | no               |
| `SUPABASE_URL`                                        | Worker secret                       | changes only if a Supabase custom domain is added    | no               |
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` / `_SECRET` | local shell only                    | local Google testing                                 | **yes** (secret) |
