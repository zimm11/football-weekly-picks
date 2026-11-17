// React Native's own URL and URLSearchParams are incomplete, so phones get the WHATWG implementation that
// Supabase expects. Browsers have a complete one: see urlPolyfill.web.ts.
import "react-native-url-polyfill/auto";
