// See urlPolyfill.ts. Browsers have a complete URL and URLSearchParams, so the web build keeps the browser's own
// and leaves the polyfill (and the Buffer shim it brings) out of the bundle.
export {};
