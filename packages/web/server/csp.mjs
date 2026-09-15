// The Content-Security-Policy this app serves, and the one path that gets a different one.
//
// A `srcdoc` iframe inherits its embedding document's CSP and intersects it with anything the
// srcdoc content declares for itself — a meta tag inside generated preview HTML can only ever
// narrow what CSP the main app already allows, never widen it. That is why the live-preview
// bundle is delivered by postMessage into public/sandbox.html rather than straight into a
// `srcdoc` iframe: that file is a real navigation, fetched as its own HTTP response, so it gets a
// policy of its own rather than inheriting one. Everything else on this origin keeps the strict
// policy below; only this one, fixed, server-authored file gets the looser one.

// script-src carries 'wasm-unsafe-eval' and connect-src reaches esm.sh for exactly one reason:
// the live-preview bundler. It runs esbuild-wasm in a same-origin worker to compile a generated
// project and fetches its npm imports from esm.sh at build time. Nothing else on this app needed
// either grant; both are as narrow as the feature requires.
export const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self' https://esm.sh; worker-src 'self' blob:; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

/**
 * The policy for the generated-app sandbox, and the reasoning behind how open it is.
 *
 * This used to be `default-src 'none'` with inline script and style and nothing else: no
 * stylesheet from a CDN, no image from anywhere, no web font, no fetch. That is a fine policy
 * for a document that must never talk to the network, and a useless one for a preview of a web
 * page, because the pages people ask for look like web pages: a Font Awesome or Bootstrap
 * stylesheet from a CDN, a Google font, hero images from Unsplash or a placeholder service, a
 * chart library from jsDelivr, sometimes a public JSON API. Every one of those was silently
 * blocked, so the preview rendered as unstyled Times New Roman with broken image icons — and the
 * dev-server badge said "Running", which was true and unhelpful.
 *
 * What actually protects the host app is not this policy but the iframe that embeds this
 * document: sandbox="allow-scripts" with no allow-same-origin gives the generated page an opaque
 * origin, so it has no access to this origin's cookies, localStorage, IndexedDB (where a
 * visitor's saved provider keys live), or /api routes with the visitor's session. A page that can
 * reach nothing of ours can be allowed to reach the public internet: the only data it could send
 * anywhere is data the model wrote into it. So the grants below are wide on purpose. 'unsafe-eval'
 * is there for the libraries that need it (in-browser Babel, template compilers); 'self' is absent
 * because an opaque origin has no self to match.
 */
export const SANDBOX_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https: blob:; style-src 'unsafe-inline' https:; img-src data: blob: https:; font-src data: https:; connect-src https: wss:; media-src data: blob: https:; worker-src blob:; frame-src https:; object-src 'none'; base-uri 'none'; form-action 'none'";

/** Which policy a given served file gets. `root` is the absolute path to the dist directory. */
export function cspFor(file, root) {
  return file === root + 'sandbox.html' ? SANDBOX_CSP : CSP;
}
