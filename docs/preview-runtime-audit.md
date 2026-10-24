# Preview runtime audit

Scope: project extraction and local asset inlining (`src/lib/project.ts`), HTML/React compilation (`src/workers/build.worker.ts`), isolated React dependencies (`server/previewRuntime.mjs`), sandbox delivery (`src/ui/OutputPanel.tsx`, `public/sandbox.html`), and production CSP (`server/csp.mjs`).

## Reproduced failures and corrections

1. **Module/global scope mismatch.** An inline HTML `onload="initCosmosEngine()"` cannot see a function declared in a module, including a classic script promoted to a module to support imports. The sandbox now bridges direct function calls named by HTML event attributes from inline modules onto `window` after module evaluation. Private module state remains scoped, browser globals and explicit bindings take precedence, and import maps remain ahead of module scripts. External module scripts must still provide explicit global bindings or use module-owned event listeners.
2. **DOM-ready listener order.** Deferred classic scripts registered on `window` ran after later initializers registered on `document`. The initializer could throw a ReferenceError even though its engine declaration appeared first in the HTML. Deferred scripts now register on `document`, retaining registration order and waiting for canvas/DOM elements to exist. This does not reorder deliberately asynchronous dependencies or repair an inherently incorrect dependency graph.
3. **Incomplete runtime diagnostics.** Promise rejections updated host status without showing the sandbox error banner. They now use the same visible diagnostic path as synchronous errors. WebGL context loss also produces a diagnostic and reload guidance without blocking unrelated controls. Reporting does not reconstruct a lost GPU context or resume a failed function.
4. **Future generated initialization.** Build instructions now require DOM/component readiness, dependency order, explicit module/global bindings when needed, context checks, visible initialization fallbacks, and WebGL context-loss handling.

## Validation

Browser regressions cover module initialization after import resolution, an actual rendered canvas pixel, promoted modules and inline click handlers, private scope and existing global preservation, reserved words in handlers, document DOM-ready ordering, asynchronous failure banners, and context-loss reporting with working controls. A served HTTP fixture additionally exercises the real nested opaque sandbox under the unchanged production sandbox CSP; its module initializer draws the expected canvas pixel.

Existing tests cover classic handler scope, duplicate declarations, import-map ordering, Tailwind ordering, React context/hooks isolation, production HTTP responses, and workspace boundaries. No CSP grants or sandbox origin permissions were changed.

## Limits and follow-up

The reported generated Cosmos project was not supplied. Its exact line 1640 and its Three.js scene/GPU behavior cannot be verified from repository source. These regressions establish failures in the preview loader; they do not establish that all generated applications are valid. A missing function, invalid shader, missing dependency, or unavailable WebGL context inside generated source still needs a source-level correction. Generic exception suppression cannot safely continue the remainder of an already-failed initialization routine.

The preview still requires correctly authored imports between modules. Bridging HTML handlers is not a substitute for module imports, and local HTML module dependency graphs are not compiled by the HTML asset-inlining path. Browser/CDN failures remain external prerequisites. Review the generated project's dependency graph and renderer lifecycle when the failing export is available.

Changes are local and have not been pushed or deployed to Render.

## Follow-up: data loss, escaping, and sandbox-only capabilities

- Reproduced missing `BOOKS`/`TRADITIONS` after cross-script `TRADITION_META` redeclarations: the old regex recognized only the first variable in a declaration. The fallback now receives top-level binding names from Acorn's AST, including comma-separated declarations and destructuring. Nested locals and comment text are excluded. Live binding getters are installed before execution, so already-initialized tables remain available if later rendering code throws; the rendering error still appears.
- Acorn is a lockfile-managed application dependency. The Vite build emits it inside `sandbox.html`, and development serves the same transformed shell. Parser source is JSON-serialized with less-than characters escaped, avoiding vendor-source HTML parsing hazards and additional network/CSP permissions.
- Raw classic-script project wrapping now JSON-serializes source, restores it with `textContent`, and executes after document readiness. A functional test verifies closing script tags, HTML comment text, template expressions and JSON survive execution. Already-truncated source cannot be safely reconstructed, and duplicate declarations within the same script remain a source error rather than being silently merged.
- A 5,000-item inert JSON registry is verified intact before initialization. Build guidance now calls for one JSON data registry, escaped less-than characters, explicit parsing and a single declaration of each table. Existing generated projects are not silently rewritten or assigned fabricated data.
- Tailwind configuration now waits for a matching asynchronous CDN script's load event rather than assuming DOM readiness means the library is ready. Failed external scripts produce a visible resource error; no fake Tailwind implementation is substituted.
- In the opaque preview realm, the unavailable service-worker property is removed so normal feature detection skips registration. Host PWA and share wiring additionally handle getters that throw `SecurityError`. The real served sandbox test exercises guarded registration, confirms the origin remains opaque and verifies canvas output. No `allow-same-origin` permission was added.
