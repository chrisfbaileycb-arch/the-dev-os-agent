# Hey Buddy, web edition

Your AI crew. Always in your corner. A browser-only, privacy-first workspace for one person or a small business: business agents you chat with, three multi-agent workflows on a browser-adapted subset of Ruflo's Agent and Task entities, a knowledge hub that stays on the device, a model hub with free and pro tiers, a credit ledger, and a sandboxed browser agent. Hosted inference goes through one streaming proxy to OpenRouter, Groq, Cohere, or an approved custom endpoint, with your own key or platform credits.

Built in the United States as an original alternative to the well-known clients. Inspired by FreeToken Web, Ruflo, AnythingLLM, LobeHub, and Cherry Studio; original code and prompts throughout, with the Apache and MIT notices for the FreeToken and Ruflo code carried in `web/`.

The application lives in [`web/`](web/). Read [`web/README.md`](web/README.md) for what is in the box, the API, environment variables, security boundaries, and verification steps. The earlier Floot-hosted edition is mirrored in [`floot/`](floot/) and runs at https://freetoken-web-ruflo.floot.app; it has not yet received this rebuild.

Both editions are installable progressive web apps. On a Chromebook, or in Chrome on any desktop, the address-bar install icon (or the Install button in Settings) adds the workspace to the shelf or dock, where it opens in its own window. The web edition also ships an offline shell, so an installed copy opens without a connection and the scripted preview keeps working; hosted provider runs still need the network.

## Layout

```
web/            Vite + React 19 front end, Web Worker orchestrator, Node 22 server
web/src/ui/     Rail, Dock, RunCard, Roster, Knowledge, Settings, StatusBar
web/src/lib/    catalog (models, tiers, credit weights), roster (personas, safety baseline), store (IndexedDB + server sync),
                chat (single-agent turn with tool loop), tools (browse protocol), orchestrator (five-stage workflows)
web/server/     index.mjs (static + API), proxy.mjs (SSE provider proxy), db.mjs (SQLite), state.mjs (/api/state), browse.mjs (/api/browse)
web/public/     manifest.webmanifest, icons/ (Hey Buddy icon set), licences
web/pwa/        service-worker.js template and build-worker.mjs, which emits dist/sw.js with the real precache list
web/src/vendor/ruflo/   Browser-adapted Ruflo Agent and Task domain entities
web/tests/      vitest unit tests and node:test server tests (mocked upstreams, a local fixture page for Chromium)
floot/          Source mirror of the earlier Floot edition
render.yaml     Render Blueprint (Docker web service with a persistent disk at /data)
.github/workflows/web.yml   CI: npm ci, Chromium install, npm test, npm run test:server, npm run build
```

## Run locally

Requires Node 22 or newer.

```sh
cd web
npm ci
npx playwright install chromium   # for the Browser Agent
npm run dev        # Vite dev server with the API, workspace store, and browse route wired in
npm test           # unit tests
npm run test:server
npm run build && npm start   # production server on PORT (default 4173)
```

## Hosting

The server streams provider responses as Server-Sent Events and keeps a SQLite file for sessions and the credit ledger, so the host must run a long-lived Node process with a writable disk and must not buffer responses. Static-only hosting and buffered serverless routers cannot serve `/api/chat`.

- **Render** (recommended): in the dashboard choose **New > Blueprint**, pick this repository, and select branch `main`. Render reads `render.yaml` and provisions a Docker service with a 1 GB disk at `/data`. A disk requires a paid instance, so the blueprint pins the `starter` plan. Leave `APP_ORIGIN` unset: the server already matches the request origin against its own host, and a wrong value makes every API call fail with 403. Set `BROWSE_ALLOWED_HOSTS` afterwards only if you want the Browser Agent switched on.
- **Any container host**: build `web/Dockerfile` (Playwright base image with Chromium); the image listens on port 8080 and stores data under `/data`.
- **Any Node host**: from `web/`, run `npm ci && npm run build && npm start`; without Chromium the browse route answers 503 and everything else works.

Copy `web/.env.example` for the full list of server environment variables. Never prefix secrets with `VITE_`.

## Licenses

Apache 2.0 for this project (see [`LICENSE`](LICENSE)). Third-party notices, including the MIT-licensed Ruflo subset, are in [`web/THIRD_PARTY_NOTICES.md`](web/THIRD_PARTY_NOTICES.md).
