import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The website (apps/mobile's Expo web build) is installable. `html` is its page template, which Expo copies to
// the build's root with the rest of `public/`.
const clients = [{ app: "apps/mobile", html: "public/index.html" }];

function client({ app, html }) {
  const root = new URL(`../${app}/`, import.meta.url);
  const publicFile = (path) => readFileSync(new URL(`public${path}`, root));
  return {
    publicFile,
    manifest: JSON.parse(publicFile("/manifest.json").toString()),
    html: readFileSync(new URL(html, root), "utf8"),
    /** Width and height from a PNG's header. */
    pngSize(path) {
      const png = publicFile(path);
      assert.equal(png.toString("latin1", 1, 4), "PNG", `${path} is not a PNG`);
      return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
    },
  };
}

for (const entry of clients) {
  const { publicFile, manifest, html, pngSize } = client(entry);

  test(`${entry.app}: the manifest has what a browser needs to offer installing the app`, () => {
    assert.equal(manifest.name, "POW Pick'em");
    assert.equal(manifest.display, "standalone");
    assert.equal(manifest.start_url, "/");
    const sizes = manifest.icons.filter((i) => i.purpose === "any").map((i) => i.sizes);
    assert.ok(sizes.includes("192x192") && sizes.includes("512x512"), "needs 192px and 512px icons");
    assert.ok(
      manifest.icons.some((i) => i.purpose === "maskable"),
      "needs a maskable icon",
    );
  });

  test(`${entry.app}: every manifest icon exists at the size it declares`, () => {
    for (const icon of manifest.icons) assert.equal(pngSize(icon.src), icon.sizes, icon.src);
  });

  test(`${entry.app}: the page links the manifest and the icons, and each file exists`, () => {
    for (const path of ["/manifest.json", "/favicon.png", "/apple-touch-icon.png"]) {
      assert.ok(html.includes(`href="${path}"`), `the page should link ${path}`);
      publicFile(path);
    }
    assert.equal(pngSize("/apple-touch-icon.png"), "180x180");
  });

  test(`${entry.app}: the iPhone app's icon is the size the App Store asks for, with no transparency`, () => {
    const root = new URL(`../${entry.app}/`, import.meta.url);
    const config = JSON.parse(readFileSync(new URL("app.json", root), "utf8")).expo;
    const png = readFileSync(new URL(config.icon, root));
    assert.equal(png.toString("latin1", 1, 4), "PNG");
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, "1024x1024");
    // Color type 2 is RGB: no alpha channel, which App Store Connect refuses in an icon.
    assert.equal(png.readUInt8(25), 2, "the icon must not have an alpha channel");
  });

  test(`${entry.app}: the manifest's colors match the page's theme color`, () => {
    assert.ok(html.includes(`name="theme-color" content="${manifest.theme_color}"`));
  });
}
