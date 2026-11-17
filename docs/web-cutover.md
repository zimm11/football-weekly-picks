# Replacing apps/web with the Expo web build

**Status: applied.** The website at `www.pow-pickem.com` was the Vite app in `apps/web`, built to
`apps/web/dist` and served as the Worker's static assets. The cutover deleted `apps/web`; the Worker now serves
the Expo app's web export (`pnpm --filter @picks/mobile build:web` → `apps/mobile/dist-web`), so one app in
`apps/mobile` is both the iPhone app and the website. This file records what changed, what to check after the
deploy, and how to undo it.

## What the cutover changed

| Change                                                                                                                            | Where                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Static Assets serve `../mobile/dist-web` (SPA fallback and `run_worker_first: ["/api/*"]` unchanged)                              | `apps/api/wrangler.jsonc`                                                       |
| `pnpm build` runs the Expo web export, then the Worker dry-run bundle                                                             | root `package.json`                                                             |
| `pnpm dev` is `pnpm mobile --web`: Supabase, the API on Node and Expo with its browser preview                                    | root `package.json`, `scripts/mobile-dev.mjs`                                   |
| `pnpm worker:dev` always serves the Expo build (`EXPO_WEB_OUT` names another output folder)                                       | `scripts/worker-dev.mjs`                                                        |
| E2E always runs against the local Worker; the Node/Vite mode and `E2E_TARGET` are gone                                            | `e2e/playwright.config.ts`, `.github/workflows/ci.yml`                          |
| CI: no component tests; `pnpm build` makes the Expo web build; `EXPO_NO_TELEMETRY` in CI and deploy                               | `.github/workflows/ci.yml`, `deploy.yml`                                        |
| Ports: `WEB_PORT` (Vite, 5173) replaced by `metro` (8081 + slot) and `worker` (9787 + slot); `APP_URL` locally is the web preview | `scripts/ports.mjs`, `ci-ports.mjs`, `supabase-env.mjs`, `supabase/config.toml` |
| Header, manifest and push-worker checks run against `apps/mobile/public` only; `pnpm icons` writes only there                     | `scripts/*.test.mjs`, `scripts/icons.mjs`                                       |
| Tailwind's Biome parser option removed                                                                                            | `biome.json`                                                                    |
| `apps/web` deleted (and its lockfile entries)                                                                                     | `pnpm-lock.yaml`                                                                |

Expo copies `apps/mobile/public/` to the root of every export, then writes `index.html` from the template there
(adding one `<script src=… defer>` per bundle before `</body>`). `app/+html.tsx` would only apply to static
output; this app uses `web.output: "single"`.

## Before deploying

**Supabase Auth redirect allowlist (production, dashboard only; it is not in the repo).** The Expo build sends
`emailRedirectTo` for sign-up (`/auth/callback`) and email change (`/account`), and `redirectTo` for password
reset (`/reset-password`, as apps/web did). Add these to Authentication → URL Configuration → Redirect URLs, or
Supabase silently falls back to the Site URL:

- `https://www.pow-pickem.com/auth/callback`
- `https://www.pow-pickem.com/account`
- `https://www.pow-pickem.com/reset-password` (already needed before)

Make sure no `EXPO_PUBLIC_API_URL` is set in the GitHub `production` environment: the web build must call its
own origin (the CSP's `connect-src` allows only `'self'` and Supabase).

## After deploying

- `curl -sI https://www.pow-pickem.com/` shows the CSP and HSTS; an `/_expo/static/js/web/entry-*.js` URL shows
  `Cache-Control: public, max-age=31536000, immutable`; `/push-sw.js` shows `no-cache`.
- Sign in, open a week (team logos from `a.espncdn.com`), and check the browser console for CSP reports. One
  `script-src 'unsafe-eval'` report per load is expected and harmless: Zod probes `new Function("")` once to
  decide whether to compile its parsers, catches the refusal and falls back. apps/web's bundle did the same.
- Request a password reset and a sign-up confirmation; both links must land on `www.pow-pickem.com`.
- Install to a home screen (iOS and Android) and enable push on a device; an existing web-push subscription keeps
  working, since the worker file, scope and VAPID keys are unchanged.

## Rollback

- **Immediately:** `pnpm --filter @picks/api exec wrangler rollback` (or the dashboard's Deployments tab). Static
  assets are versioned with the Worker, so the previous version brings the Vite site back; no migration is
  involved, so nothing else to undo. The API is unchanged by the cutover, so tabs on either client keep working.
- **Then:** `git revert` the cutover commit on main (which redeploys the Vite build through `deploy.yml`).
- Supabase redirect URLs added in "Before deploying" can stay.

## Notes and known gaps

### Deploy skew

Expo Router splits each route into its own lazily loaded file on the web by default. Static Assets keep only the
current deploy's files, and unknown paths fall back to `index.html`, so an open tab from before a deploy would
fail to load the next screen it opened. `app.json` sets `["expo-router", { "asyncRoutes": { "web": false } }]`, so
the web build is one bundle loaded by the page, as apps/web's was (native builds were already unsplit). Open tabs
then keep their whole app until reloaded, which is the existing rule ("the API must stay backward-compatible").

### Fonts are the app's own files

Metro serves an asset from where it lives, and under `node_modules/.pnpm/@scope+name@version/` Cloudflare
redirects (307) every font request once to the percent-encoded path. The six Barlow `.ttf` files are therefore
copied into `apps/mobile/assets/fonts/` (with `OFL.txt`) and required from there in `app/_layout.tsx`.

### Bundle size

Measured on 2026-11-16 with `expo export --platform web` (JS only; gzip -9 and brotli as a CDN would send it):

| Build                                                                        | Raw      | gzip   | brotli |
| ---------------------------------------------------------------------------- | -------- | ------ | ------ |
| Expo web, before (3 large chunks + 21 route chunks)                          | 3,410 KB | 797 KB | 641 KB |
| Expo web, after the trims, still split                                       | 2,106 KB | 550 KB | 445 KB |
| Expo web, after the trims, one bundle (`asyncRoutes.web: false`, what ships) | 2,107 KB | 540 KB | 425 KB |
| apps/web (Vite, for comparison, JS + CSS)                                    | 1,027 KB | 281 KB | 237 KB |

The trims, all web-only (the iOS bundle is unchanged):

- `src/components/GestureRoot.web.tsx`: a plain `View` instead of gesture-handler's root, which pulled in
  `react-native-gesture-handler` and `react-native-reanimated` (with worklets and semver): about 920 KB raw.
  Nothing on the web uses a gesture-handler gesture; add it back there before using one.
- `metro.config.cjs` + `src/lib/zodLocales.web.js`: `z.locales` keeps English only. Metro doesn't tree-shake, and
  `zod`'s classic API re-exports all ~50 translations: about 270 KB raw.
- `src/lib/urlPolyfill.web.ts`: browsers keep their own `URL` instead of `react-native-url-polyfill` (which also
  replaced it): about 60 KB raw (`whatwg-url-without-unicode`, `buffer`).

What's left, largest first: expo-router with its vendored React Navigation (~440 KB), react-native-web
(~280 KB), the app's own code (~230 KB), zod's core (~230 KB), react-dom (~200 KB), Supabase (~250 KB, of
which Realtime, Storage, PostgREST, Functions and Iceberg, ~130 KB, are unused: the app only uses Auth, so
`@supabase/auth-js` directly would drop them, a change to `src/lib/api.ts` and its test), Phosphor icons (~110 KB
for 38 icons in six weights each). Expo's experimental tree shaking (`EXPO_UNSTABLE_TREE_SHAKING=1`) saved under
10 KB without further Metro changes, so it isn't used.
