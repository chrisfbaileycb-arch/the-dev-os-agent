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
- Both must be green. Baseline: 358 vitest tests; ~241 node server tests (2 skipped).
- Every POST route that acts on the server (`/api/fetch`, `/api/browse`, `/api/mcp`,
  `/api/connectors/call`, `/api/media/call`, `/api/engine`, `/api/github`) calls `checkOrigin`
  and carries a per-IP hourly budget. `/api/engine` is the one route that sends a
  visitor-supplied provider key on the header, so it is rate-limited like the connectors
  (`ENGINE_MAX_PER_HOUR`, default 60). Keep new act-on-server routes on the same pattern.
- Some `.mjs` files are test fixtures, not suites (e.g. `budget-fixture.mjs`).
- `tests/*.test.mjs` assert against real Node http servers and real modules; they are not
  run by CI's `npm test`. Do not let them bit-rot.

## Server layout

- `packages/web/server/index.mjs` composes an ordered `handlers` array; each handler gets
  `(req, res)` and returns `true` when it handled the request.
- `packages/web/server/controller.mjs` (the customer spending controller: per-account
  allowance, global cap, concurrency gate, watchdog) is **unit-tested but not wired** into
  `index.mjs`. It is `node:sqlite`-only and refuses a non-`DatabaseSync` handle on purpose —
  production is Postgres, so a Postgres-backed adapter is required before it can guard live
  traffic. Do not call it from `proxy.mjs` without that adapter.
- Funded pools are metered **server-side on the wire**: `proxy.mjs` writes `mode:'free'`/
  `mode:'credits'` ledger rows from `createMeter` usage, and the free/plan gates read those
  server keys (`usedThisMonth`). The client-authored ledger pushed to `/api/state` feeds only
  display and the legacy `CREDIT_MONTHLY_POOL`, which gates nothing — do not move a spending
  decision onto it.
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

## Hugging Face is removed

- Hugging Face was purged from the app: no registry entry, provider union, provider card, key
  slot, catalog model, MCP preset, or server route (`providerRegistry.mjs`, `proxy.mjs`,
  `freetier.mjs`, `settings.mjs`, `vault.mjs`, `keyProbe.mjs`). Do not reintroduce it; tests in
  `core.test.ts`, `model-lanes.test.ts`, `provider-registry.test.mjs`, `proxy.test.mjs`, and
  `backend-lane.test.mjs` assert an unknown id like `huggingface` is refused, never assumed.

## MCP tool grid vs optional media tools

- `packages/web/src/lib/mcpServers.ts` lists only real MCP servers (remote + bridge). The two
  optional media tools (HeyGen, Nano Banana) are NOT presets — they are configured in the
  dedicated media accordion in `Connectors.tsx`, so the "N integrations" count is not padded.
  `mcp-presets.test.ts` and `sandbox-ui.test.tsx` pin the count at 23.

## Spending lanes (who pays for a request)

There are two independent lanes, decided entirely on the server in `proxy.mjs` `fundingFor`:

- **BYOK — the visitor's own key.** When the request carries a personal `apiKey`, the proxy uses
  it, does **not** reserve from the operator's daily USD budget (`funding.mode !== 'byok'`), and
  does **not** write a server ledger row. Their inference time and their provider bill; the
  operator neither pays for nor meters it. The `OPERATOR_FUNDING_DISABLED` switch and the
  free/plan credit pools never apply to it — the switch only fires when no personal key is
  present. This is deliberate: BYOK is out of the operator's control, and it should stay that way.
- **Operator-funded — the deployment's own keys.** A keyless request (the free tier) or one
  carrying a plan access token (the paid tier) runs on the deployment's keys, and **only** then
  does the proxy reserve from `DAILY_SERVER_BUDGET_USD` and record usage server-side. What the
  operator funds is exactly what the admin dashboard lists as free or paid, bounded by the
  free-tier knobs (`FREE_CREDIT_MONTHLY_POOL`, `FREE_MAX_PER_HOUR`, `FREE_MAX_OUTPUT_TOKENS`) and
  the USD budget.

The operator's levers all live in the admin dashboard: `PUT /api/admin/keys` (which provider keys
the deployment holds), `PUT /api/admin/tiers` (which models are free vs paid), and
`PUT /api/admin/tunables` (the credit/output/rate limits). A visitor's personal key is never
stored on the server — it stays in page memory — and is never counted against an operator budget.

## Verifying both suites

- Frontend: `cd packages/web && npx vitest run`.
- Server: `cd packages/web && node --test tests/*.test.mjs`. Run BOTH — the server suite is
  separate from vitest and catches catalog/registry regressions vitest will not.
