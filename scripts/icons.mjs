// Draws the app icons from the theme's colors and display font: `pnpm icons`. The website's go into its public
// folder (apps/mobile/public, copied into the Expo web build); the iPhone app's is apps/mobile/assets/icon.png. The PNGs are committed, so this only needs running when the
// icon design changes. It renders with Playwright's Chromium (`pnpm playwright:install`).
//
// It also draws the boot mark, apps/mobile/public/boot-mark.png: the splash's POW mark (src/components/Splash.tsx),
// which public/boot.css shows on the empty page until the app's scripts have loaded. `node scripts/icons.mjs
// boot-mark` draws only that one, leaving the icons as they are.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const root = new URL("..", import.meta.url);
const folders = ["apps/mobile/public"];
const appAssets = "apps/mobile/assets";
const fromE2e = createRequire(new URL("e2e/package.json", root));

// The display font, Barlow Condensed ExtraBold: the copy the Expo app bundles (app/_layout.tsx).
const fontFile = (name) => readFileSync(new URL(`apps/mobile/assets/fonts/${name}`, root)).toString("base64");
const font = fontFile("BarlowCondensed_800ExtraBold.ttf");
// And Bold, for PICK'EM under the boot mark.
const boldFont = fontFile("BarlowCondensed_700Bold.ttf");

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

/*
 * The boot mark: Splash.tsx's mark with the same fonts (registered under the app's own family names, as expo-font
 * does), sizes, spacing and colors (`foreground`, `pow`, `mutedForeground`), on a transparent background, at 2x.
 * The mark is 235.27 by 191px; it is drawn centered in a 240 by 192px box, so the image has whole-pixel sizes
 * and boot.css can center it exactly where the splash centers the mark. Change one, change the other.
 */
const BOOT_MARK = { width: 240, height: 192 };
const bootMark = `<!doctype html>
<style>
  @font-face { font-family: "BarlowCondensedExtraBold"; src: url(data:font/ttf;base64,${font}) format("truetype"); }
  @font-face { font-family: "BarlowCondensed"; src: url(data:font/ttf;base64,${boldFont}) format("truetype"); }
  html, body { margin: 0; background: transparent; }
  .box { width: ${BOOT_MARK.width}px; height: ${BOOT_MARK.height}px; display: flex; align-items: center;
    justify-content: center; }
  .mark { display: flex; flex-direction: column; align-items: stretch; }
  .word { font: 140px/128px "BarlowCondensedExtraBold"; letter-spacing: 1px; color: #f1f4fb; white-space: pre-wrap; }
  .bar { height: 10px; margin-top: 8px; background: #ff3d5e; }
  .tag { font: 24px "BarlowCondensed"; letter-spacing: 9px; color: #94a0bd; text-align: center; margin-top: 16px;
    white-space: pre-wrap; }
</style>
<div class="box"><div class="mark"><div class="word">POW</div><div class="bar"></div><div class="tag">PICK'EM</div></div></div>`;

const only = process.argv[2];
if (only && only !== "boot-mark") {
  console.error(`Unknown drawing "${only}". Run with no argument for every icon, or "boot-mark".`);
  process.exit(1);
}
const { chromium } = fromE2e("@playwright/test");
const browser = await chromium.launch();
try {
  const tab = await browser.newPage({
    viewport: { width: BOOT_MARK.width, height: BOOT_MARK.height },
    deviceScaleFactor: 2,
  });
  await tab.setContent(bootMark);
  await tab.evaluate(() => document.fonts.ready);
  const png = await tab.locator(".box").screenshot({ omitBackground: true });
  await tab.close();
  writeFileSync(new URL("apps/mobile/public/boot-mark.png", root), png);
  console.log("wrote apps/mobile/public/boot-mark.png");
  for (const { name, size, scale, dirs = folders } of only ? [] : icons) {
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
