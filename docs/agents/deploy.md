# CI, deploy and the live site

The README has the runbooks ("Deployment", "Email", "Push notifications", "Monitoring and recovery"). This doc is what a change must respect.

## Workflows (`.github/workflows/`)

- Workflow actions are pinned to full commit SHAs with the version in a trailing comment (a tag can be moved; a SHA can't); Dependabot updates both. The `main` ruleset requires `check` and `e2e` to pass before a merge.
- `ci.yml` runs on PRs. Job `check`: Gitleaks history scan, lint, typecheck (including the Worker against its runtime types), migration drift check, unit + script tests, the app's tests and iOS JavaScript bundle, and `pnpm build`. Job `e2e`: local Supabase, DB-backed API tests, Playwright against the Worker.
- `deploy.yml` runs on push to main: CI → connection-string check → `supabase db push` → `pnpm build` → `wrangler deploy` → `scripts/check-live.mjs` (polls `$APP_URL/api/health`). A failed live check doesn't undo the deploy; `wrangler rollback` does, and rollback doesn't undo migrations.
- `uptime.yml` checks health every 15 minutes and opens one `uptime` issue per outage. `contract.yml` runs `pnpm test:contract` daily and opens a `feed-contract` issue on failure.

## What a deploy means for code

- **Migrations deploy before the new code ships**, so keep them backward-compatible (expand, then contract).
- **The web build and API go live together, but open tabs keep the old web build and installed iPhone apps keep theirs**, so the API must stay backward-compatible with both.
- The web build needs no env vars (it fetches `/api/config` at runtime) and calls its own origin: no `EXPO_PUBLIC_API_URL` may be set for it.
- Only `wrangler.jsonc`, `src/worker.ts` and the deploy job are Cloudflare-specific; `apps/api/src/index.ts` still runs the API on any Node host with `PORT` and `DATABASE_URL`.

## The Worker (`apps/api/wrangler.jsonc`)

- Worker `pow-pickem`: assets from the Expo web build with SPA fallback, `run_worker_first` for `/api/*`, the `HYPERDRIVE` binding, the `EMAIL` (`send_email`) binding limited to `noreply@pow-pickem.com`, the `AI` (Workers AI) binding for screening (left out of `pnpm worker:dev`'s config unless `WORKER_DEV_SCREENING=1`), the Cron Trigger (`*/5 * * * *`), placement in `aws:us-east-1` (the Supabase region), logs and traces on.
- `workers_dev` and `preview_urls` stay off: the zone's rate limiting rule (dashboard only; 50 `/api/*` requests in 10 s blocks an IP for 10 s) only covers the custom domain.
- **Cost:** the account is on Workers Paid, which Email Sending to players requires. A Workers spend limit blocks `/api/*` (error 1103) and the cron at $10 of usage, so a request flood can take the app down. Billing settings change only in the dashboard.

## Secrets

- GitHub environment `production`: `SUPABASE_DB_URL` (the session pooler URL for migrations; GitHub runners are IPv4-only), `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`; variable `APP_URL`.
- Worker secrets (`wrangler secret put`): `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (account deletion), optional `OPERATOR_USER_IDS`, `UNSUBSCRIBE_SECRET` to turn email on, and `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` to turn push on.
- Supabase Auth's Site URL and redirect URLs must point at the public URL, and the redirect URLs must include `/reset-password`, `/auth/callback` and `/account` (and the app's `pow-pickem://` links, `apps/mobile/README.md`).
- As a backstop for tests, production Auth's Before User Created hook (`public.hook_reject_test_signups`) refuses sign-ups on reserved test domains (`example.com`, `.test`, `.invalid`…).

## Headers, caching and installability

- **Security headers:** `apps/mobile/public/_headers` sends HSTS, a CSP (scripts from `'self'` only; styles from `'self'` and `'unsafe-inline'`; images from `'self'` and `data:`; connections to `'self'` and Supabase), `frame-ancestors 'none'`, nosniff and a referrer policy with every page; the API adds the same through `secureHeaders()` plus `Cache-Control: no-store`. `scripts/headers.test.mjs` checks all of this.
- **The app loads no third-party images, fonts or scripts.** Any new external host must be added to the CSP, and to the Privacy policy.
- Keep inline scripts and inline `style` attributes out of `apps/mobile/public/index.html` (react-native-web and expo-font inject `<style>` elements at runtime, which `style-src 'unsafe-inline'` allows).
- Metro puts a content hash in everything under `/_expo/static` and `/assets`, which `_headers` caches as immutable.
- **Installable:** `apps/mobile/public/manifest.json` and the `apple-*` tags in `index.html` let the website be added to a home screen. Keep the manifest's `theme_color` equal to the page's `theme-color` meta tag (`scripts/manifest.test.mjs` checks it). The icons are committed PNGs drawn by `scripts/icons.mjs` (`pnpm icons`, only after changing the design there).
- **The only service worker is the push-only `apps/mobile/public/push-sw.js`** (served `no-cache`). It caches no pages or responses, so nothing works offline; its one Cache Storage entry is the endpoint of a push subscription the browser replaced, for the app to report.
