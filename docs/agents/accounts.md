# Accounts, sign-in and Settings

Code: `apps/api/src/auth.ts` (`requireAuth` verifies Supabase access tokens), `apps/api/src/accounts.ts` (account deletion), the profile routes in `apps/api/src/app.ts`; in the app, `apps/mobile/src/lib/auth.tsx` (the session and profile), `apps/mobile/src/lib/links.ts`, `apps/mobile/src/lib/authErrors.ts`, `apps/mobile/src/screens/AuthScreen.tsx` and `NameScreen.tsx`. Auth email templates are in `supabase/templates/`.

## Signing in

- Email and password through Supabase Auth, then a display name: required before anything else, and the API refuses to create or join a league, or post, without one.
- The sign-in card has two modes, Sign in and Create account. It opens on Create account on the home page, on an invite and with `?mode=signup`, and on Sign in everywhere else; an email that already has an account turns it to Sign in.
- Auth errors reach players in plain words through `authMessage`, never as Auth's own text.
- **Hosted Auth settings aren't in the repo:** `supabase/config.toml` is local only. Production requires email confirmation, and the hosted project's email templates are updated by hand (README, "Links in sign-in emails").

## Emailed links

- Links asked for on the website (sign-up confirmation, reset, email change) carry a token hash in the fragment, which the app verifies with `verifyOtp` (`authCallback` in `links.ts`), so they work in any browser or device. Older `?code=` links still work in the browser that asked.
- A link's outcome is a banner (or, signed out, the top of the sign-in form), and the token leaves the address bar.
- A `next` path (an invite, `/account` from `/unsubscribe`) survives sign-in only if `nextPath` allows it.
- "Forgot password?" emails a link that signs the player in on `/reset-password`; the account menu's **Change password** reaches the same screen.

## Deleting an account

Settings → **Delete account** (`DELETE /me` with the password) deletes at once. Needs `SUPABASE_SECRET_KEY`.

- Personal data is cleared in one transaction: devices, queued email, blocks, reactions, reads, picks in weeks that aren't final (survivor picks too), squares on boards that haven't locked, and message text. Their threads keep others' replies under `DELETED_THREAD_TITLE`; feedback they sent stays without its sender; the avatar selection is cleared.
- They leave every league; a league they were the only member of is deleted. A league's only admin must hand over admin first.
- The profile becomes `DELETED_PLAYER_NAME` with `deleted_at`, and then Supabase Auth soft-deletes the user: the `auth.users` row stays, email scrambled, so picks from final weeks keep their foreign keys and nobody's results change.
- **Never hard-delete an `auth.users` row:** it cascades through every table.
- `refuseDeletedAccounts` wraps the token check at both entrypoints, so a deleted account's unexpired tokens are refused. Tests that cover deletion wrap their verifier the same way.

## Settings and profile

- `/account` is **Settings**, in three groups: Notifications (by email and on this device), Account, and Help. Rows are `SettingsRow`s.
- **Profile pictures:** `/change-name` offers bundled logos; the optional `profiles.avatar_id` selects the same picture across leagues and devices, and null shows initials.
- **Home-screen help** (`apps/mobile/src/components/HomeScreenInstall.tsx`, `apps/mobile/src/lib/homeScreen.ts`): browser users find it in Settings, where it opens a sheet with the steps for their platform. On a phone, the first successful pick save in a browser (or first survivor pick, or first square claimed; `offerHomeScreen(reason)`) opens the same sheet once (`pow:home-screen-offered` in localStorage; no storage means no offer). Computers never get the automatic offer. Hide all of it in standalone mode.
