# AGENTS.md

Repository notes for agents working in Signal Forge OS.

## Build and verification

- No `typecheck` script. `npm run build` runs `tsc --noEmit` first, then `vite build`.
- There are **two** test suites, and they are easy to confuse:
  - `npm test` (workspace `packages/web`) = `vitest run`. Its include is
    `tests/**/*.test.{ts,tsx}` — it **does not run `.mjs` tests**.
  - `npm run test:server --workspace=packages/web` = `node --test tests/*.test.mjs`.
    This is where the server-module tests live. Run it before claiming a server change is
    verified; a green `npm test` says nothing about it.
- Both must be green. Baseline: 355 vitest tests; ~241 node server tests (2 skipped).
- Some `.mjs` files are test fixtures, not suites (e.g. `budget-fixture.mjs`).
- `tests/*.test.mjs` assert against real Node http servers and real modules; they are not
  run by CI's `npm test`. Do not let them bit-rot.

## Server layout

- `packages/web/server/index.mjs` composes an ordered `handlers` array; each handler gets
  `(req, res)` and returns `true` when it handled the request.
- Shared helpers: `HttpError`, `readBody`, `publicAddress`, `resolveTarget` in
  `server/proxy.mjs`; `checkOrigin` in `server/state.mjs`.
- Provider eligibility lives in `server/providerRegistry.mjs`
  (`BACKEND_IDS` / `isBackendProvider`). `US_BACKEND_IDS` are the funded US providers.
- Funded lanes and free-tier pools are in `server/freetier.mjs`, `server/proxy.mjs`,
  `server/budget.mjs`, `server/plans.mjs`.

## Conventions

- Do not widen the CSP (`server/csp.mjs`) to reach a third-party API from the browser.
  Proxy through a server route so `connect-src` stays `self` and credentials stay off the page.
- A route that has no `US_BACKEND_*` membership is not funded; keep BYOK-only routes that
  way, and reject requests without a personal key rather than falling back to an operator key.
- `packages/web/src/lib/curatedSkills.json` feeds the Skills tab and the engine. A markdown
  file under `public/skills/` alone does not surface — but see below before adding to the
  catalog.

## Skill catalog invariants

- `packages/web/src/lib/curatedSkills.json` is the imported-skills catalog. Every entry
  must carry a real `provenance` with a matching `sha256`, because
  `packages/web/tests/skills-import.test.mjs` asserts `BUILTIN_SKILLS.length === 65` and
  re-hashes every `markdown`. Never hand-add or hand-edit an entry here.
- First-party pathways (The Drill, The Ledger, Scribe, Researcher, Jev System-1 Router)
  live inline in `packages/web/src/lib/skillRegistry.ts` with `kind: 'instructions'`,
  `url: ''`, and `fields: []`. A readable copy may still ship under `packages/web/public/skills/`.
- The Jev System-1 Router is a toggle, not a key. It is pure operational understanding of the
  router pattern; it must never name a key field or a server route. The old
  `/api/typesafe/systemone` BYOK route was removed — do not reintroduce a keyed path for it.

## Visitor keys vs admin keys

- The visitor Settings page (`packages/web/src/ui/Settings.tsx`) shows ONE universal BYOK
  card: a provider `<select>` over `BYOK_CHOICES`, one key field, and Save / Use & discover /
  Clear. Keys stay in page session memory only.
- The multi-provider key matrix is an admin-only concern. Do not reintroduce per-provider
  key rows on the visitor page.

## Verifying both suites

- Frontend: `cd packages/web && npx vitest run`.
- Server: `cd packages/web && node --test tests/*.test.mjs`. Run BOTH — the server suite is
  separate from vitest and catches catalog/registry regressions vitest will not.
