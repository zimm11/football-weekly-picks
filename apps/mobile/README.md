# POW Pick'em for iPhone and the web

Expo Router + React Native client for the Hono API. The same app is the website: `pnpm --filter @picks/mobile build:web` exports it to `dist-web`, which the Cloudflare Worker serves as its static assets (`pnpm build` does this), and in a browser it calls the API on its own origin. Native builds call `https://www.pow-pickem.com` by default. No database credentials or Supabase service-role keys belong in the app.

Web-only code lives in `*.web.ts(x)` files beside their native versions (Metro picks the right one per platform). `public/` holds the website's `_headers` (security headers and caching), `manifest.json` and icons, the push service worker `push-sw.js`, and the page template `index.html` with `boot.css`; Expo copies it to the root of the web build. `metro.config.cjs` keeps only Zod's English locale in the web bundle.

## Run locally

One-time setup: install Docker Desktop, and Expo Go from the App Store on your iPhone.

Then, with Docker running, from the repository root:

```sh
pnpm mobile
```

Scan the QR code it prints with the iPhone's Camera (phone and computer on the same Wi-Fi). Sign in as `admin@example.com` / `password123`; the root README lists the other test accounts.

It starts this checkout's Supabase (applying new migrations, never resetting data), then the API and Expo. It works out your computer's LAN address and this worktree's ports itself, so there are no IPs or `.env` files to edit. It prints the web preview, Supabase Studio and test-inbox URLs. The API and Supabase output goes to `apps/mobile/.expo/logs/` so it doesn't bury the QR code; if one of them stops, the launcher shows the end of its log. Ctrl+C stops everything except Supabase (`pnpm db:stop`).

| Command                    | Use it to                                                                        |
| -------------------------- | -------------------------------------------------------------------------------- |
| `pnpm mobile`              | Test on your phone against local data (the usual one)                            |
| `pnpm mobile --web`        | The same, plus the Expo browser preview (the website); `pnpm dev` runs this      |
| `pnpm mobile --dev-client` | The same, for an installed development build instead of Expo Go                  |
| `pnpm mobile --clear`      | Clear Metro's cache (it already does this when your network changes)             |
| `pnpm mobile:prod`         | Run the app against **production** (real data); Metro only, nothing local starts |

Each worktree runs its own copy at once (its own ports, Metro, database and logs), so you can test two branches side by side; scan a worktree's QR code to switch the phone to it. Sign-ins are saved per server, so switching never carries one worktree's session into another.

If it says a port is in use, stop the other `pnpm dev` or `pnpm mobile` in this checkout first. It never switches ports or kills other processes. On a computer with several networks, pick Wi-Fi by name: `MOBILE_DEV_INTERFACE=en0 pnpm mobile`. Expo's tunnel mode isn't supported, because the phone must also reach the API and Supabase on your network.

The launcher reads database credentials from this checkout's local Supabase only, never from a hosted database set in your shell, and passes Expo nothing but public addresses. The browser preview's CORS access is development-only and limited to this checkout's Expo origins.

## Implemented flows

- Supabase email/password sign-in and signup, required display name, password recovery, name/email/password updates and sign-out.
- League creation, invite joining/sharing, five league tabs and shared season selection.
- Picks, explicit POW, tiebreaker, save-time reconciliation of changes that lock or disappear, live refresh and app resume.
- Final results, awards, standings, player season statistics and weekly recap.
- Matchup stats/news/market sheets, loaded on demand.
- Message board pagination, unread state, threads, replies, quotes, reactions, pin/unpin/delete permissions.
- League membership/commissioner tools and week setup, import/edit games, manual results, open/finalize/reopen and announcement posting.
- Email notification preferences, native device notifications, feedback, operator dashboard and signed-out unsubscribe confirmation.
- Native navigation and sign-out safeguards for unsaved work.

The native client calls the same authenticated endpoints; it never reads league data directly from Supabase Postgres. Server locks, permissions, privacy and scoring remain authoritative. Keep API changes backward compatible with older installed clients.

## Auth and links

Add these redirects to the Supabase Auth URL allowlist:

- `pow-pickem://auth/callback`
- `pow-pickem://reset-password`
- `pow-pickem://account`

PKCE callbacks must open on the device that initiated the flow. The app also handles legacy implicit token callbacks. Keep tokens out of logs and screenshots. Sessions and native notification ownership are persisted with Expo SecureStore.

The configured bundle identifier is `com.powpickem.app`; confirm it before creating store records. Universal links need the corresponding Apple Associated Domains capability and a served `/.well-known/apple-app-site-association` file using the real Apple Team ID and bundle identifier. The app declares `applinks:www.pow-pickem.com`; the server association cannot be completed until that identity is known. Custom-scheme auth callbacks work separately.

## Native push

1. The EAS project id is in `app.json` (`extra.eas.projectId`; it is public). Sign in with `pnpm mobile:eas login`.
2. Configure APNs credentials and Push Notifications capability through EAS/Apple. Build a development client; test on a real device.
3. Apply the additive native-push database migration through the repository migration workflow. It adds a transport discriminator and native receipt tracking; browser subscriptions remain compatible.
4. Set server `EXPO_PUSH_ENABLED=true`. If Expo enhanced push security is enabled, configure `EXPO_ACCESS_TOKEN` as a server secret, never `EXPO_PUBLIC_*`.
5. In Settings → On this device, enable notifications. This is opt-in; startup never asks for permission.

Native and web devices use the same reminder/queue eligibility rules. Native deliveries go to Expo's push gateway and receipts are checked later. A ticket alone is not final delivery confirmation. Sign-out disconnects the device before clearing the session; a failed disconnect leaves the user signed in with an error so the next account cannot inherit it.

## Verify and release

Run EAS through `pnpm mobile:eas` from the repository root; the shortcut selects `apps/mobile` automatically. EAS commands run at the repository root directly cannot find the app's Expo dependency.

```sh
pnpm mobile:eas login
```

```sh
pnpm mobile:check
pnpm mobile:export
pnpm check
pnpm build
```

CI typechecks the app, tests its pure behavioral helpers, exports the iOS JavaScript bundle and the web build, and runs the Playwright E2E suite against the web build on a local Worker. Bundle export is not an Xcode archive and does not prove device behavior. Verify cold launch, invite/password links, background resume near kickoff, navigation with drafts, VoiceOver, keyboard/safe-area layout and native push on a physical iPhone.

The EAS profiles include development, simulator, preview and production. After signing in to EAS and linking the Apple account, use `pnpm mobile:eas build --platform ios --profile production` and `pnpm mobile:eas submit --platform ios --profile production`. These commands upload externally and require the account owner's credentials and release authorization.

Before App Store submission, complete physical-device QA, store metadata/screenshots/privacy declarations, account deletion and message-board reporting/blocking/filtering requirements. Those last account/moderation features are missing from the current web product too and are not claimed complete by this migration. Verify sports-data/logo rights and the actual contest/prize model as part of preparing the submission. No App Store or TestFlight release has been performed by this source migration.
