# Design

Read before changing any screen or component. Paths are under `apps/mobile/src/` unless they start from the repo root. The app draws with React Native primitives (`View`, `Text`, `Pressable`) and `StyleSheet`; react-native-web turns them into DOM and CSS on the web. The tokens and their values are in `components/theme.ts`; this doc says how to use them.

## Look

- **One theme, dark only.** Use the tokens (`colors`, `fonts`); don't hard-code colors. Electric blue (`primary`) is the player's pick and the main action; red (`pow`) is the Pick of the Week and nothing else; green (`win`) is won picks and results; coral (`destructive`) is lost picks, errors and removals. Primary-colored text and icons on a primary tint or on `raised` use `primaryText`, since plain `primary` falls under 4.5:1 there. A solid POW fill that carries white text is `powFill`. `colors.avatars` are hues the app gives no meaning to (no red, green, coral or primary blue).
- **Surfaces, not outlines.** Layers are told apart by fill: `background` → `card` → `raised` (selected rows, unpicked buttons, hover). Borders are hairlines for dividers, not boxes around cards. No colored left-border stripes for callouts; use a tinted fill or an icon.
- **Tokens for everything measured:** corners from `radius` through `corner(r)`, spacing from `space`, page and card padding from `layout`, content widths from `widths`.
- **Shadows are only for what floats** over the page, from `elevation`. Every card, and nothing else, carries the lit top edge `elevation.cardEdge`; a card that sets its own `boxShadow` combines it with `cardEdge`. From 1024px wide, `apps/mobile/public/boot.css` lays a wash of primary light over the top of the window; pages don't fight it with backgrounds of their own.
- **Type, two levels.** Barlow Condensed capitals (`fonts.display*`) for page and section titles, team names, scores and big stat numbers. Barlow, in sentence case, for everything else. Text styles come from `type` in `theme.ts`: spread one and add a color. Digits are `tabular` where numbers stack in a column, sit in a row of peers or change in place. `Title` takes `size` rather than an inline `fontSize`. Both faces are bundled in `apps/mobile/assets/fonts/`, so the app makes no third-party font requests. Text goes inside `Text` or a text component (Biome's `noReactNativeRawText`).
- **Results are never color alone.** A won pick also gets a check, a lost one a strike-through, a push an equals sign, and each says "won", "lost" or "push" to screen readers (`screens/WeekResults.tsx`).
- **Team badges** are the app's own drawings, never the teams' logos: `TeamLogo` (`components/TeamLogo.tsx`) draws a disc in the team's colors with a generic glyph for the team or its city, from `lib/teamBadges.ts`. Don't load or trace a team's real mark, and don't pick a glyph that is one (a star for Dallas, a horseshoe for Indianapolis). They are decorative: always show the team name or abbreviation beside one. `Avatar` is decorative too; show the name beside it.
- **Phone first.** Tap targets are at least 44px. Use a whole-row link (`RowLink`) rather than a word of link text. Anything pinned to the bottom edge sits above the tab bar and the safe-area inset. Tables are rows of `View`s with explicit `role="row"`/cell roles; a table that scrolls sideways keeps its player column in place (`stickyFirst` in `screens/SeasonDashboard.tsx`) and marks the signed-in player's row.

## Copy

- Say it once and briefly. Rules and footnotes go behind a disclosure (`Disclosure` in `screens/leagueUi.tsx`) or on How to play, not in paragraphs above the content.
- Say "commissioner", never "admin"; "pro football", never "NFL" (the one exception is the Terms of use' non-affiliation line); and never name the data provider: say "Auto-fill games and spreads", "Auto-fill results", "fill in automatically" or "the pro football schedule", so the provider can be swapped without changing the app's words. This covers screens, How to play, Terms, Privacy, the page description and manifest, emails, push and API error messages.
- Message times use `messageTime` (`lib/messagePresentation.ts`).

## Components

Reuse the building blocks rather than styling a new control; they are already tuned for touch (44px controls, 16px field text so iOS doesn't zoom). They are in `components/ui.tsx` and, for league screens, `screens/leagueUi.tsx`.

- `Button` is the one button; `Action` (league screens) and `WeekAction` (`screens/weekUi.tsx`) are thin adapters over it. Variants: `primary`, `secondary`, `ghost`, `link`, `destructive`. A button whose own request is running takes `busy` rather than `disabled`, so it keeps keyboard focus, and says what it is doing ("Saving…").
- `Badge` is the one pill (`Pill` and `WeekBadge` map onto it). `StatTile` is the one stat tile (`WeekStat` maps onto it). `Field` is the one text field (`Input` maps onto it; `hint`, `reveal`).
- A card's title is `CardTitle`, not `Eyebrow` (a label over a group) or `Heading` (a section title on the page background). `Title` and `Heading` take a `level`; one level 1 per page.
- "Nothing here yet" is `EmptyState`. A failed load is `Failure` (`ErrorMessage` with **Try again**).
- Both `Sheet`s are one bottom sheet (`components/BottomSheet.tsx`); don't build another. Below 768px it slides up from the bottom edge; from 768px it is a centered dialog. A sheet whose content loads in place holds a placeholder of the content's height, so it opens at its final size.
- A growing multiline box is `AutoGrowInput`: never feed a measured height back through state on the web (that loop once blanked the app). A date and time is `DateTimeField`. A choice from a list is `Select` (the browser's own `<select>` on the web, a `Menu` on iPhone); a set of choice cards is `ChoiceList`.
- Icons are Phosphor through `Icon` (`components/Icon.tsx`): each glyph is imported from its own file, since Metro doesn't tree-shake, so add a new one to its `ICONS` map.
- Ask with `showConfirm` (`lib/dialogs.tsx`) or `confirm(...)` in `screens/leagueUi.tsx`, never `window.confirm` or `Alert.alert`.
- **Secondary and destructive row actions** (member roles and removal, removing a game, pinning a thread) live in a "⋯" `Menu` (`components/Popover.tsx`, anchored with `useAnchor`) on the row, named `Options for <name>`; each `MenuItem` keeps a full accessible name ("Remove Pat"). Keep the one main action of a screen as a visible button.

## Interaction

- **Links are links.** Anything that goes to another screen takes `href` (`Button`, `Action`, `RowLink`, `WeekAction`, or `AppLink` in `components/AppLink.tsx` for a custom row): on the web it is a real `<a href>`, and a plain click stays in the app and goes through the unsaved-work guard. Don't write `accessibilityRole="link"` on a Pressable with an `onPress` that navigates: react-native-web doesn't press a `role="link"` element on Enter.
- **Every control answers the pointer and the keyboard.** Pressables style `hovered` and `pressed` through `pressState`/`hoverFill`/`pressFade` (`components/pressState.ts`); a big choice tile (a team, the POW, a square, a choice card) takes `pressTile(state, selected)`. The focus ring is one `:focus-visible` rule in `apps/mobile/public/boot.css`. `Field` and `Input` take `onSubmit` (pass it on every form, with `enterKeyHint="next"` moving focus between fields). Menus move with the arrow keys; a checkbox or radio card toggles on Space.
- **Feedback goes where the user is looking.** The outcome of an action is announced with `notifyDone` / `notifyError` (`lib/notify.tsx`), a banner pinned near the bottom, never a message at the top of a long page. The exceptions sit beside their button: the pick sheet's save bar, and validation inside a form (`Notice` or `ErrorMessage`, one kind per form). An optimistic change (a reaction, a square claim) shows at once and rolls back with `notifyError`.
- **Haptics (iPhone)** go through `haptics` (`lib/haptics.ts`; the web file does nothing): `select()` when a choice changes, `toggle()` for a significant switch (the POW), `warn()` for a destructive question (`showConfirm` does it), `success()`/`warn()`/`error()` for how an action turned out. `notifyDone`/`notifyError` already call `success()`/`error()`, so a screen that raises the banner adds none of its own. Not on every tap, and never where the system already gives one (pull to refresh, native pickers).

## Motion

- The vocabulary is in `lib/motion.ts`: `duration`, `easing`/`cssEasing`, the one spring `pop` (through `usePop(on)`), `nativeDriver` for every `useNativeDriver`, and `webTransition([...properties])` for CSS transitions on the web (always name the properties, never `all`). `FadeIn` fades something in where it appears; `SkeletonBlock` is the pulsing placeholder block.
- A hover, press or tint change takes `fast` with `out`; something appearing in place `base` with `out`; something leaving one step shorter with `in`; a travelling panel `slow`. A fade moves at most 8px.
- Only opacity and transform animate (and the pick sheet's progress bar), never a height.
- Every `Animated` user honors `useReducedMotion()` by jumping to the end value; `boot.css` stops CSS transitions and animations under the browser's reduce-motion setting.
- Use React Native's `Animated`, never Reanimated. A CSS animation on the web works only in a style made with `StyleSheet.create` on a plain `View` or `Text`, not through `Animated`.

## Loading

- Show a placeholder shaped like the screen (`Skeleton` in `screens/leagueUi.tsx`, or the screen's own built from `SkeletonBlock`), never a bare "Loading…" line; each is named for what is loading and marked busy. Content that replaces a placeholder on a cold mount fades in (`FadeIn`); a screen drawn from the load cache doesn't.
- Opening the app is the exception: `Splash` (`components/Splash.tsx`) covers loading the fonts, then the session and profile. Before the scripts load, `boot.css` shows `boot-mark.png` on the same pixels as the splash's mark: redraw it with `node scripts/icons.mjs boot-mark` after changing `Splash`.
- A load that fails shows `Failure` or `ErrorMessage` with **Try again**, never a dead end. A load that answers 404 shows `NotFound` with a way home instead, since trying again can't help. A lost session signs the player out with "Your session ended" (`lib/api.ts`). A render error shows `ErrorScreen` (the root `ErrorBoundary`) with **Reload**, never a blank page.
