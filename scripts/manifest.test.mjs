import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const web = new URL("../apps/web/", import.meta.url);
const publicFile = (path) => readFileSync(new URL(`public${path}`, web));
const manifest = JSON.parse(publicFile("/manifest.json").toString());
const html = readFileSync(new URL("index.html", web), "utf8");

/** Width and height from a PNG's header. */
function pngSize(path) {
  const png = publicFile(path);
  assert.equal(png.toString("latin1", 1, 4), "PNG", `${path} is not a PNG`);
  return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
}

test("the manifest has what a browser needs to offer installing the app", () => {
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

test("every manifest icon exists at the size it declares", () => {
  for (const icon of manifest.icons) assert.equal(pngSize(icon.src), icon.sizes, icon.src);
});

test("the page links the manifest and the icons, and each file exists", () => {
  for (const path of ["/manifest.json", "/favicon.png", "/apple-touch-icon.png"]) {
    assert.ok(html.includes(`href="${path}"`), `index.html should link ${path}`);
    publicFile(path);
  }
  assert.equal(pngSize("/apple-touch-icon.png"), "180x180");
});

test("the manifest's colors match the page's theme color", () => {
  assert.ok(html.includes(`name="theme-color" content="${manifest.theme_color}"`));
});
