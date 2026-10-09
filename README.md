# Signal Forge OS, web edition

Your AI crew. Always in your corner. A privacy-first workspace for one person or a small business: business agents you chat with, three multi-agent workflows on a browser-adapted subset of Ruflo's Agent and Task entities, a connectors hub, a knowledge hub that stays on the device, a model hub, a credit ledger, and a sandboxed browser agent. Hosted inference goes through one streaming proxy. The funded free tier is US labs only.

**Open it and type.** On a deployment with server provider keys, a first-time visitor gets a live streaming reply with no sign-up, no API key, and nothing to configure: the server funds models only from US providers (Anthropic, OpenAI, Google, xAI, Groq, Cerebras), chosen in the admin dashboard. The dock has three model groups: **Models** (those US labs, plus whatever this deployment funds), **Experiment** (OpenRouter and Hugging Face, your key, not the free tier, and not Shield), and **On this machine**. The monthly free-tier number is counted in the browser unless this host has durable storage (Postgres via `DATABASE_URL`, or a SQLite file outside `/tmp`). The live Render service has no disk, so it does not claim to remember that quota. `FREE_MAX_PER_HOUR` is the in-memory cap that bounds spend on the deployment's keys, and it dies with the process.

Everything an operator configures — provider keys, which models are free and which are on the paid plan, the free-tier limits — is entered in an admin dashboard at `/admin` (gated by `ADMIN_TOKEN`) and applies to the next request without a redeploy. A visitor who brings a key sees every model that key reaches, listed live from the provider in the prompt bar's model menu.

Built in the United States as an original alternative to the well-known clients. Inspired by FreeToken Web, Ruflo, AnythingLLM, LobeHub, and Cherry Studio; original code and prompts throughout, with the Apache and MIT notices for the FreeToken and Ruflo code carried in `packages/web/`. Carol Ann is the owner's own reference for the skills registry, not an upstream.

The application lives in [`packages/web/`](packages/web/). Read [`packages/web/README.md`](packages/web/README.md) for what is in the box, the API, environment variables, security boundaries, and verification steps. The earlier Floot-hosted edition has been removed; `packages/web/` is the only edition, and Render is the deployment target.

`web/` at the repo root is only a Render build bridge (a two-script package.json). Do not edit application code there.

It is an installable progressive web app. On a Chromebook, or in Chrome on any desktop, the address-bar install icon (or the Install button in Settings) adds the workspace to the shelf or dock, where it opens in its own window. It ships an offline shell, so an installed copy opens without a connection and the scripted preview keeps working; hosted provider runs still need the network.

## Layout

```
packages/web/            Vite + React 19 front end, Web Worker orchestrator, Node 22 server
packages/web/src/ui/     Rail, Dock, ModelPicker, RunCard (pipeline strip), Connectors, Roster, Knowledge, Settings, StatusBar
packages/web/src/lib/    catalog (models, tiers, credit weights), providers (connection profiles), deployment (what this host funds),
                connectors (GitHub, URL crawler, documents, MCP as agent tools), roster (personas, safety baseline),
                store (IndexedDB + server sync), chat (single-agent turn with tool loop), orchestrator (five-stage workflows)
packages/web/server/     index.mjs (static + API), proxy.mjs (SSE provider proxy and funding decision), admin.mjs (/api/admin dashboard
                routes), settings.mjs (dashboard keys, knobs and tiers laid over the environment), secrets.mjs (AES-GCM
                sealing for stored keys), models.mjs (one shape for every provider's model list), freetier.mjs (zero-config
                allowlist and quotas), meter.mjs (server-side token metering), db.mjs (SQLite), state.mjs (/api/state),
                fetch.mjs (/api/fetch), github.mjs (/api/github), mcp.mjs (/api/mcp), browse.mjs (/api/browse),
                jobs.mjs (/api/jobs queue), worker.mjs (Render background worker)
packages/web/public/     manifest.webmanifest, icons/ (Signal Forge OS icon set), licences
packages/web/pwa/        service-worker.js template and build-worker.mjs, which emits dist/sw.js with the real precache list
packages/web/src/vendor/ruflo/   Browser-adapted Ruflo Agent and Task domain entities
packages/web/tests/      vitest unit tests and node:test server tests (mocked upstreams, a local fixture page for Chromium)
render.yaml     Render Blueprint: one free Node web service, no disk, optional free Postgres. The monthly free-tier ledger stays in the browser unless DATABASE_URL or a durable DATA_FILE is set.
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
npm run build && npm start   # production server on PORT (default 10000)
npm run worker     # optional background worker (needs WEB_SERVICE_URL and WORKER_TOKEN)
```

Export a real `GROQ_API_KEY` or `OPENROUTER_API_KEY` before `npm run dev` to see the zero-config tier: open the app in a private window, type a prompt, and it should stream without anything entered in Settings.

## Live deployment

**https://hey-buddy-web.onrender.com** — Render service `hey-buddy-web`, auto-deploying from `main`.

One standard Node web service — no Docker, no persistent disk, no background worker. `render.yaml`
now declares exactly this, so recreating from the Blueprint reproduces what is running. Two
consequences worth knowing:

- **No Chromium**, so the Browser Agent cannot run and `/api/browse` answers 503. Everything else
  works, including the URL crawler connector, which needs no browser.
- **No disk**, so `DATA_FILE=/tmp/heybuddy.sqlite` is wiped on every restart and redeploy. Sessions still sync when the process is up, and each browser keeps IndexedDB. The monthly free-tier quota is counted in the browser and is not a server memory. Admin settings written only to that SQLite file do not survive. OpenRouter, Hugging Face, and the execution-engine key stay in the browser unless storage is durable. `FREE_MAX_PER_HOUR` remains the only server-side spend bound, and it resets when the process does. If the blueprint's free Postgres is attached (`DATABASE_URL`), admin settings and the server ledger do survive; the page says which one you are on.

Both are reversible without a rewrite; see **Scaling up** in [`packages/web/README.md`](packages/web/README.md).

The zero-config free tier is off until a US-lab key such as `GROQ_API_KEY` is set in the Render dashboard. OpenRouter and Hugging Face do not fund that tier. Until a US key is set, visitors see *"Public free tier warming up — enter your own key in Settings or try again shortly."* and can supply their own key or use a local model.

## Hosting

The server streams provider responses as Server-Sent Events. On a host with no durable database the monthly free-tier ledger lives in the browser. A durable host (`DATABASE_URL`, or `DATA_FILE` outside `/tmp`) may keep that ledger itself. The host must run a long-lived Node process and must not buffer responses. Static-only hosting and buffered serverless routers cannot serve `/api/chat`.

- **Render** (recommended): in the dashboard choose **New > Blueprint**, pick this repository, and select branch `main`. Render reads `render.yaml` and provisions two services — a Docker web service with a 1 GB disk at `/data`, and an optional Node background worker for heavier multi-step runs, sharing a generated `WORKER_TOKEN`. A disk requires a paid instance, so the blueprint pins the `starter` plan. Delete the worker block if you want a single service; workflows then run in the browser, which is the default anyway.
  - Set `ADMIN_TOKEN` in the dashboard, open `/admin`, and enter provider keys and model tiers there — or set `GROQ_API_KEY` or `OPENROUTER_API_KEY` directly to switch the zero-config free tier on. Without them the app still deploys and works, but opens in the scripted preview and asks each visitor for their own key.
  - Leave `APP_ORIGIN` unset: the server already matches the request origin against its own host, and a wrong value makes every API call fail with 403.
  - Set `BROWSE_ALLOWED_HOSTS` afterwards only if you want the Browser Agent switched on.
- **Any container host**: build `packages/web/Dockerfile` (Playwright base image with Chromium); the image listens on port 8080 and stores data under `/data`.
- **Any Node host**: from `packages/web/`, run `npm ci && npm run build && npm start`; without Chromium the browse route answers 503 and everything else works.

Copy `packages/web/.env.example` for the full list of server environment variables. Never prefix secrets with `VITE_`.

## Licenses

Apache 2.0 for this project (see [`LICENSE`](LICENSE)). Third-party notices, including the MIT-licensed Ruflo subset, are in [`packages/web/THIRD_PARTY_NOTICES.md`](packages/web/THIRD_PARTY_NOTICES.md).
