# App structure

How `apps/mobile` is put together: routes, the league's tabs, and the plumbing every screen shares. Paths are under `apps/mobile/` unless they start from the repo root. For how things look and behave, see `docs/agents/design.md`.

## Where things live

- `app/` — Expo Router routes: thin files that render a screen. `app/_layout.tsx` holds the providers, fonts, header, `Splash` and the root `ErrorBoundary`.
- `src/screens/` — screen implementations; they do the fetching (`useLeagueLoad` in `leagueUi.tsx`, or `useResource` in `src/lib/hooks.ts`). Each league type's screens live in its own folder exporting its entry from `index.tsx` (`weekly/`, `playoff/`, `squares/`, `survivor/`); `leagueTypeScreens.tsx` maps each type to its tab screens, League-tab admin tools and recap (`LEAGUE_TYPE_SCREENS`).
- `src/components/` — shared components and the theme.
- `src/lib/` — adapters (`api.ts` makes API requests and holds the Supabase client; `auth.tsx` the session and profile; `clock.ts`; `notify.tsx`; push, storage, deep links) and pure helpers with a Node test beside them. Keep components presentational and put logic worth testing in a pure function here.
- **Web-only variants** are `*.web.ts(x)` files beside the native ones (Metro picks one per platform): browser push, the history guard, `<select>`, storage and bundle trims.
- `public/` — `_headers`, `manifest.json`, the icons, `push-sw.js`, and the page template `index.html` with `boot.css` and `boot-mark.png`, copied to the build's root.
- `pnpm --filter @picks/mobile build:web` (part of `pnpm build`) exports the web build to `dist-web`, the Worker's static assets. It is one bundle (`asyncRoutes.web: false` in `app.json`), so an open tab survives a deploy. `README.md` here has device setup and release prerequisites.

## Routes

- `/` Your leagues (signed out: the home page, which pitches weekly pick'em with an example pick whose caption comes from the real point rules, `exampleCaption` in `src/lib/landing.ts`). `/leagues/new`, `/join/<code>`.
- `/leagues/:id` and its tabs (below). `/weeks/:id` is one week as every player sees it, `/weeks/:id/manage` the admin's week management. `/boards/:id`, `/boards/:id/manage` and `/boards/new?league=:id` are squares'.
- `/account` is **Settings** (`/notifications` shows it too, for old links), `/change-name`, `/reset-password`, `/unsubscribe?token=`, `/feedback` (at most `FEEDBACK_DAILY_LIMIT` a day), `/operator` (a 404 for anyone not in `OPERATOR_USER_IDS`).
- `/`, `/login`, `/how-to-play`, `/terms`, `/privacy` and `/unsubscribe` work signed out.
- How to play (`app/how-to-play.tsx`) has one tab per league type; `?section=<type>` selects one and the tab sets it back, so links and Back keep the tab. Each type's text is its own `HowToPlay<Type>.tsx`, built from `src/components/Guide.tsx`.

## A league is one tab navigator

- A league is one screen of the stack holding a tab navigator (`app/leagues/[id]/_layout.tsx`, Expo Router's JS `Tabs` with the app's own tab bar). The Messages tab is a small stack (`messages/_layout.tsx`) with a thread pushed over the board.
- Tabs come from the type (`LEAGUE_TYPE_INFO[type].tabs`). The first is `/leagues/:id`; a tab path the type lacks is the not-found screen.
- `src/screens/LeagueScreen.tsx` is the shared shell: `LeagueShell` loads the league once for every tab and shares it through `leagueContext.ts`; `LeagueTab` draws each tab with its header.
- In a browser a tab is a link, each tab change is a history entry so Back walks the tabs, and only the tab showing is in the page (`FocusedOnly`). On iPhone the tabs switch in place and every visited tab stays as it was, so Back leaves the league.
- Every league screen (a tab, a week, its manage screen, a board) draws its header and tab row with `LeagueFrame`, so the row sits at the same height everywhere. The tab bar (`LeagueTabBar` in `src/screens/LeagueChrome.tsx`) is along the bottom on phones and a row at the top from 768px. A tab bar drawn on a screen above the league goes back down to that tab.
- One season selector applies across the season-based tabs and is remembered per league in session storage; it sits on the header's "All leagues" row (`LeagueHeader`), with the league's name on its own line below. Squares has a Boards list instead.

## Shared plumbing

- **Loads are remembered.** `useLeagueLoad` and `useResource` keep the last answer per key in memory (`src/lib/loadCache.ts`) and show it at once on the next mount while they refresh. Key a load by its API path when the value is that path's response, so screens share it (the pick sheet, Manage week and the recap share `/weeks/${weekId}`). Anything done once from loaded data (seeding a form, showing a recap) waits for the hook's `fresh`. The cache is emptied on sign-out and whenever the signed-in player changes; never persist it.
- **The browser's own chrome works.** Every screen names itself with `usePageTitle` (`src/lib/pageTitle.ts`; route files behind `AuthGate` use `useGatedPageTitle`). A screen with its own `ScrollView` passes it `useScrollRestore()`, so Back and Forward return to where the player was.
- **Back closes the top overlay** in a browser (a sheet, the `showConfirm` dialog, a `Menu`/`Popover`) and stays on the page, through the same history guard as unsaved work (`src/lib/browserGuard.web.ts`). `BottomSheet`, `Popover` and the dialog join it with `useOverlayBack`; anything else drawn in a `Modal` must too.
- **Unsaved work is guarded.** A screen with unsaved edits calls `useEditsGuard` (`src/screens/leagueUi.tsx`) or `useFormGuard` (`src/lib/hooks.ts`), which ask before in-app navigation, the browser's back and forward, and **Sign out**, and warn on reload or tab close. A guard is off while its own work is being saved (`dirty && !busy`). Anything that replaces the screen without the router seeing it awaits `confirmDiscard()` first.
- **Pull to refresh** on iPhone goes through `usePullRefresh` (`src/lib/pullRefresh.ts`), which spins only for the player's own pull.
- **The profile's loading state** lives in `src/lib/profileLoad.ts`: whichever of the first load or a refresh answers first ends it, so nothing can leave the app on the splash.
- **Notification taps** open a path only if it is on the allowlist, which is kept in two places (see `docs/agents/notifications.md`).
