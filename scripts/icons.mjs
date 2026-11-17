// Draws the app icons from the theme's colors and display font: `pnpm icons`. The website's go into its public
// folder (apps/mobile/public, copied into the Expo web build); the iPhone app's is apps/mobile/assets/icon.png. The PNGs are committed, so this only needs running when the
// icon design changes. It renders with Playwright's Chromium (`pnpm playwright:install`).
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const root = new URL("..", import.meta.url);
const folders = ["apps/mobile/public"];
const appAssets = "apps/mobile/assets";
const fromE2e = createRequire(new URL("e2e/package.json", root));

// The display font, Barlow Condensed ExtraBold: the copy the Expo app bundles (app/_layout.tsx).
const font = readFileSync(
  new URL("apps/mobile/assets/fonts/BarlowCondensed_800ExtraBold.ttf", root),
).toString("base64");

// Colors are the `chrome`, `foreground` and `pow` tokens (apps/mobile/src/components/theme.ts).
// `scale` is how much of the square the wordmark fills: Android crops a maskable icon to a shape,
// keeping only the middle 80%, so that one is drawn smaller.
const page = (scale) => `<!doctype html>
<style>
  @font-face { font-family: "Barlow Condensed"; font-weight: 800;
    src: url(data:font/ttf;base64,${font}) format("truetype"); }
  html, body { margin: 0; height: 100%; background: #030817; }
  body { display: grid; place-items: center; }
  .mark { display: grid; justify-items: stretch; transform: scale(${scale}); }
  .word { font: 800 46vw/0.8 "Barlow Condensed"; color: #f1f4fb; letter-spacing: 0.01em; padding-bottom: 5vw; }
  .bar { height: 6vw; background: #ff3d5e; }
</style>
<div class="mark"><div class="word">POW</div><div class="bar"></div></div>`;

const icons = [
  { name: "icon-192.png", size: 192, scale: 1 },
  { name: "icon-512.png", size: 512, scale: 1 },
  { name: "icon-maskable-512.png", size: 512, scale: 0.72 },
  // iOS rounds the corners itself and wants no transparency.
  { name: "apple-touch-icon.png", size: 180, scale: 1 },
  { name: "favicon.png", size: 48, scale: 1.1 },
  // The iPhone app's icon and splash image (app.json). The App Store wants 1024px, square, with no transparency.
  { name: "icon.png", size: 1024, scale: 1, dirs: [appAssets] },
];

const { chromium } = fromE2e("@playwright/test");
const browser = await chromium.launch();
try {
  for (const { name, size, scale, dirs = folders } of icons) {
    const tab = await browser.newPage({ viewport: { width: size, height: size } });
    await tab.setContent(page(scale));
    await tab.evaluate(() => document.fonts.ready);
    const png = await tab.screenshot();
    await tab.close();
    for (const dir of dirs) {
      writeFileSync(new URL(`${dir}/${name}`, root), png);
      console.log(`wrote ${dir}/${name}`);
    }
  }
} finally {
  await browser.close();
}
