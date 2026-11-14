// Draws the app icons into apps/web/public from the theme's colors and display font: `pnpm icons`.
// The PNGs are committed, so this only needs running when the icon design changes. It renders with
// Playwright's Chromium (`pnpm playwright:install`).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = new URL("..", import.meta.url);
const out = (name) => fileURLToPath(new URL(`apps/web/public/${name}`, root));
const fromWeb = createRequire(new URL("apps/web/package.json", root));
const fromE2e = createRequire(new URL("e2e/package.json", root));

const font = readFileSync(
  fromWeb.resolve("@fontsource/barlow-condensed/files/barlow-condensed-latin-800-normal.woff2"),
).toString("base64");

// Colors are the `chrome`, `foreground` and `pow` tokens from apps/web/src/styles.css.
// `scale` is how much of the square the wordmark fills: Android crops a maskable icon to a shape,
// keeping only the middle 80%, so that one is drawn smaller.
const page = (scale) => `<!doctype html>
<style>
  @font-face { font-family: "Barlow Condensed"; font-weight: 800;
    src: url(data:font/woff2;base64,${font}) format("woff2"); }
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
];

const { chromium } = fromE2e("@playwright/test");
const browser = await chromium.launch();
try {
  for (const { name, size, scale } of icons) {
    const tab = await browser.newPage({ viewport: { width: size, height: size } });
    await tab.setContent(page(scale));
    await tab.evaluate(() => document.fonts.ready);
    await tab.screenshot({ path: out(name) });
    await tab.close();
    console.log(`wrote apps/web/public/${name}`);
  }
} finally {
  await browser.close();
}
