# Hey Buddy, web edition

Your AI crew. Always in your corner. A privacy-first workspace for one person or a small business: business agents you chat with, three multi-agent workflows on a browser-adapted subset of Ruflo's Agent and Task entities, a connectors hub, a knowledge hub that stays on the device, a model hub, a credit ledger, and a sandboxed browser agent. Hosted inference goes through one streaming proxy to OpenRouter, Groq, Cohere, or an approved custom endpoint.

**Open it and type.** On a deployment with server provider keys, a first-time visitor gets a live streaming reply with no sign-up, no API key, and nothing to configure: the server funds a fixed allowlist of free models from its own Groq and OpenRouter keys and meters every request against a visible credit quota. Bring your own key to unlock Claude 3.5 Sonnet, DeepSeek R1, and GPT-4o, and the quota stops applying.

Built in the United States as an original alternative to the well-known clients. Inspired by FreeToken Web, Ruflo, AnythingLLM, LobeHub, and Cherry Studio; original code and prompts throughout, with the Apache and MIT notices for the FreeToken and Ruflo code carried in `web/`.

The application lives in [`web/`](web/). Read [`web/README.md`](web/README.md) for what is in the box, the API, environment variables, security boundaries, and verification steps. The earlier Floot-hosted edition has been removed; `web/` is the only edition, and Render is the deployment target.

It is an installable progressive web app. On a Chromebook, or in Chrome on any desktop, the address-bar install icon (or the Install button in Settings) adds the workspace to the shelf or dock, where it opens in its own window. It ships an offline shell, so an installed copy opens without a connection and the scripted preview keeps working; hosted provider runs still need the network.

## Layout

```
web/            Vite + React 19 front end, Web Worker orchestrator, Node 22 server
web/src/ui/     Rail, Dock, ModelPicker, RunCard (pipeline strip), Connectors, Roster, Knowledge, Settings, StatusBar
web/src/lib/    catalog (models, tiers, credit weights), providers (connection profiles), deployment (what this host funds),
                connectors (GitHub, URL crawler, documents, MCP as agent tools), roster (personas, safety baseline),
                store (IndexedDB + server sync), chat (single-agent turn with tool loop), orchestrator (five-stage workflows)
web/server/     index.mjs (static + API), proxy.mjs (SSE provider proxy and funding decision), freetier.mjs (zero-config
                allowlist and quotas), meter.mjs (server-side token metering), db.mjs (SQLite), state.mjs (/api/state),
                fetch.mjs (/api/fetch), github.mjs (/api/github), mcp.mjs (/api/mcp), browse.mjs (/api/browse),
                jobs.mjs (/api/jobs queue), worker.mjs (Render background worker)
web/public/     manifest.webmanifest, icons/ (Hey Buddy icon set), licences
web/pwa/        service-worker.js template and build-worker.mjs, which emits dist/sw.js with the real precache list
web/src/vendor/ruflo/   Browser-adapted Ruflo Agent and Task domain entities
web/tests/      vitest unit tests and node:test server tests (mocked upstreams, a local fixture page for Chromium)
render.yaml     Render Blueprint: a Docker web service with a persistent disk at /data, plus an optional background worker
.github/workflows/web.yml   CI: npm ci, Chromium install, npm test, npm run test:server, npm run build
```

## Run locally

Requires Node 22 or newer.

```sh
cd web
npm ci
npx playwright install chromium   # for the Browser Agent
npm run dev        # Vite dev server with the API, workspace store, and every connector route wired in
npm test           # unit tests
npm run test:server
npm run build && npm start   # production server on PORT (default 4173)
npm run worker     # optional background worker (needs WEB_SERVICE_URL and WORKER_TOKEN)
```

Export a real `GROQ_API_KEY` or `OPENROUTER_API_KEY` before `npm run dev` to see the zero-config tier: open the app in a private window, type a prompt, and it should stream without anything entered in Settings.

## Live deployment

**https://hey-buddy-web.onrender.com** — Render service `hey-buddy-web`, auto-deploying from `main`.

That service was created directly rather than from the Blueprint, so it differs from `render.yaml`
in two ways worth knowing:

- **It runs the Node runtime, not Docker**, so Chromium is absent. Everything works except the
  Browser Agent, whose `/api/browse` answers 503. The URL crawler connector is unaffected — it
  needs no browser.
- **It has no persistent disk**, so `DATA_FILE=/tmp/heybuddy.sqlite` is ephemeral. Sessions, the
  ledger, and the free-tier quota reset on every restart and redeploy. Be aware of what that costs
  once a provider key is set: a quota that resets is a weaker spend cap than one that persists, and
  the per-IP hourly limit (`FREE_MAX_PER_HOUR`, in memory) resets with it. To get the durable
  version, replace the service with a Blueprint from `render.yaml`, which provisions the Docker
  runtime and a 1 GB disk at `/data`.

The zero-config free tier is off until `GROQ_API_KEY` or `OPENROUTER_API_KEY` is set in the Render
dashboard. Until then the app opens in the scripted preview and asks each visitor for their own key.

## Hosting

The server streams provider responses as Server-Sent Events and keeps a SQLite file for sessions and the credit ledger, so the host must run a long-lived Node process with a writable disk and must not buffer responses. Static-only hosting and buffered serverless routers cannot serve `/api/chat`.

- **Render** (recommended): in the dashboard choose **New > Blueprint**, pick this repository, and select branch `main`. Render reads `render.yaml` and provisions two services — a Docker web service with a 1 GB disk at `/data`, and an optional Node background worker for heavier multi-step runs, sharing a generated `WORKER_TOKEN`. A disk requires a paid instance, so the blueprint pins the `starter` plan. Delete the worker block if you want a single service; workflows then run in the browser, which is the default anyway.
  - Set `GROQ_API_KEY` or `OPENROUTER_API_KEY` in the dashboard to switch the zero-config free tier on. Without them the app still deploys and works, but opens in the scripted preview and asks each visitor for their own key.
  - Leave `APP_ORIGIN` unset: the server already matches the request origin against its own host, and a wrong value makes every API call fail with 403.
  - Set `BROWSE_ALLOWED_HOSTS` afterwards only if you want the Browser Agent switched on.
- **Any container host**: build `web/Dockerfile` (Playwright base image with Chromium); the image listens on port 8080 and stores data under `/data`.
- **Any Node host**: from `web/`, run `npm ci && npm run build && npm start`; without Chromium the browse route answers 503 and everything else works.

Copy `web/.env.example` for the full list of server environment variables. Never prefix secrets with `VITE_`.

## Licenses

Apache 2.0 for this project (see [`LICENSE`](LICENSE)). Third-party notices, including the MIT-licensed Ruflo subset, are in [`web/THIRD_PARTY_NOTICES.md`](web/THIRD_PARTY_NOTICES.md).
