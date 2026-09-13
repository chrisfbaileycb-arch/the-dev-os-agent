// The Content-Security-Policy this app serves, and the one path that gets a different one.
//
// A `srcdoc` iframe inherits its embedding document's CSP and intersects it with anything the
// srcdoc content declares for itself — a meta tag inside generated preview HTML can only ever
// narrow what CSP the main app already allows, never widen it. That is why the live-preview
// bundle is delivered by postMessage into public/sandbox.html rather than straight into a
// `srcdoc` iframe: that file is a real navigation, fetched as its own HTTP response, so it gets a
// policy of its own rather than inheriting one. Everything else on this origin keeps the strict
// policy below; only this one, fixed, server-authored file gets the looser one, and what runs
// inside it can never read this origin's cookies or storage regardless — the iframe embedding it
// still carries sandbox="allow-scripts" with no allow-same-origin, so its origin is opaque no
// matter which URL served it.

// script-src carries 'wasm-unsafe-eval' and connect-src reaches esm.sh for exactly one reason:
// the live-preview bundler. It runs esbuild-wasm in a same-origin worker to compile a generated
// project and fetches its npm imports from esm.sh at build time. Nothing else on this app needed
// either grant; both are as narrow as the feature requires.
export const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self' https://esm.sh; worker-src 'self' blob:; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

export const SANDBOX_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'";

/** Which policy a given served file gets. `root` is the absolute path to the dist directory. */
export function cspFor(file, root) {
  return file === root + 'sandbox.html' ? SANDBOX_CSP : CSP;
}
