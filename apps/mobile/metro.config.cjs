// Expo's default Metro config (it sets up the pnpm workspace itself), with one change for the web build.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Zod re-exports every one of its ~50 translations of its error messages as `z.locales`, and Metro doesn't
// tree-shake, so all of them (about 0.3 MB of script) would ship to the browser. The app only uses English,
// which Zod sets as its default straight from locales/en.js. In the web build, `z.locales` holds English only
// (src/lib/zodLocales.web.js); phones keep Zod as published.
const zodLocales = path.join(path.sep, "zod", "v4", "locales", "index.js");
const webLocales = path.join(__dirname, "src", "lib", "zodLocales.web.js");
// Zod is @picks/shared's dependency, so the stand-in's import of English resolves from there.
const shared = require.resolve("@picks/shared");
const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = resolveRequest ?? context.resolveRequest;
  if (platform === "web" && context.originModulePath === webLocales)
    return resolve({ ...context, originModulePath: shared }, moduleName, platform);
  const resolution = resolve(context, moduleName, platform);
  if (platform === "web" && resolution.type === "sourceFile" && resolution.filePath.endsWith(zodLocales))
    return { type: "sourceFile", filePath: webLocales };
  return resolution;
};

module.exports = config;
