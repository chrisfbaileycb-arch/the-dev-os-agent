# Hey Buddy, web edition

A browser-only workspace for one person or a small business: a chat with a business agent, three multi-agent workflows, a knowledge hub that stays on the device, a model hub with free and pro tiers, a credit ledger, and a sandboxed browser agent. Runs on a Chromebook or any modern browser, installs as an app, and needs no account.

Inspired by FreeToken Web, Ruflo, AnythingLLM, LobeHub, and Cherry Studio. Original code and prompts; the Apache and MIT notices for the FreeToken and Ruflo code carried in this directory are in `THIRD_PARTY_NOTICES.md`.

## What is in the box

- **Workspace.** Sessions on the left, one chat canvas, a floating prompt dock with file drag-and-drop, paste-to-attach, a voice toggle (Web Speech API where the browser has it), and live token counters. Enter sends; Shift+Enter breaks a line.
- **Agent roster.** Operational Executive, Financial Auditor, Content and Reputation Specialist, and the Browser Agent lead a chat. Dispatcher, Researcher, Architect, Reviewer, and Scribe run the workflows *Plan it*, *Look into it*, and *Check my work* as a five-stage dependency graph on browser-adapted Ruflo entities, in the lead agent's focus. Every prompt starts with the same safety baseline (`src/lib/roster.ts`).
- **Knowledge hub.** Notes and imported text files in IndexedDB, retrieved by keyword and attached to messages and runs. Never sent to the server store.
- **Model hub.** A curated catalog (`src/lib/catalog.ts`): free and instant models on Groq and OpenRouter's free pool, pro and reasoning models through OpenRouter, plus any model ID or an approved custom OpenAI-compatible endpoint. Two ways to pay: bring your own key (optionally remembered in this browser, never charged) or platform credits (the deployment's model pool behind an access token, metered by model weight).
- **Credit ledger.** Every request is logged with tokens and credits: fast models 0.5 credits per 1K tokens, standard 3, reasoning 15; BYOK and the scripted preview log at zero. The status bar shows the model, tier, payment mode, time to first token, output speed, remaining credits, and sync state.
- **Browser Agent.** `POST /api/browse` opens one public page in headless Chromium and returns title, description, canonical, robots, headings, social tags, visible text, and links. Guardrails: an explicit host allowlist (`BROWSE_ALLOWED_HOSTS`), public IPv4 only (re-checked on every request the page makes), no downloads or credentials, timeouts, and a per-workspace hourly budget. The agent asks for it with a single `TOOL {...}` line; at most three calls per message.
- **Persistence.** Sessions, runs, and the ledger are saved in IndexedDB and mirrored to SQLite on the server (`server/db.mjs`, Node's built-in `node:sqlite`) under an anonymous workspace id the browser mints. A refresh, a reinstall, or a cleared cache keeps history and balances as long as the id survives in localStorage; there are no accounts.
- **Installable.** Web app manifest, Hey Buddy's icon set, an Install button in Settings, and a shell service worker generated at build time so an installed app opens offline (the scripted preview keeps working; hosted models need a connection).

## Run locally

Requires Node 22.

```sh
npm ci
npx playwright install chromium   # only for the Browser Agent and its test
npm run dev                       # Vite with the API, workspace store, and browse route wired in
npm test && npm run test:server   # unit tests, then server tests (SQLite, proxy, browse)
npm run build && npm start        # production server on PORT (default 4173)
```

## Deploy

The server streams provider responses as Server-Sent Events and keeps a SQLite file, so the host must run a long-lived Node process with a writable disk. Static hosting cannot serve `/api/chat`.

- **Docker (recommended).** `Dockerfile` builds on `mcr.microsoft.com/playwright`, so Chromium is present for the Browser Agent. Mount a volume at `/data`.
- **Render.** The root `render.yaml` uses the Docker runtime with a 1 GB disk at `/data`. Set `APP_ORIGIN`, and `BROWSE_ALLOWED_HOSTS` if you want the Browser Agent.
- **Any Node host without Chromium.** `/api/browse` answers 503 and the rest of the app works.

## Environment

See `.env.example`.

| Variable | Purpose |
|---|---|
| `APP_ORIGIN` | Public origin; used for origin checks and OpenRouter attribution. |
| `DATA_DIR` / `DATA_FILE` | Where the SQLite file lives. Put it on a persistent disk. |
| `CREDIT_MONTHLY_POOL` | Platform credits per workspace per calendar month (default 100,000). |
| `BROWSE_ALLOWED_HOSTS` | Hosts the sandbox browser may open. Empty disables it; `*` allows any public host. |
| `BROWSE_MAX_PER_HOUR` | Per-workspace page budget (default 30). |
| `CUSTOM_API_ORIGINS`, `OLLAMA_BRIDGE_URL` | Approved custom endpoints and an administrator bridge to a home model server. |
| `SERVER_CREDIT_ACCESS_TOKEN`, `*_API_KEY` | Server keys used only for requests carrying the access token (platform credits). |

## API

- `POST /api/chat` streams SSE from OpenRouter, Groq, Cohere, or an approved custom endpoint; `POST /api/models` lists models; `GET /api/providers` reports the bridge. Unchanged from the FreeToken edition; see `server/proxy.mjs`.
- `GET /api/state` returns the workspace's sessions, runs, ledger, and pool; `POST /api/state` upserts them; `POST /api/state/clear` deletes. Requires `X-Workspace-Id`.
- `POST /api/browse` with `{ "url": "https://..." }` returns a page report or a 4xx/5xx with a plain message.

## Security and privacy

- Provider keys travel over HTTPS to this proxy and on to the provider; the server never stores or logs them. The optional "remember key" setting uses unencrypted localStorage on the device.
- The workspace id is a bearer of its own data: anyone holding it can read that workspace's sessions from the server. It never leaves the browser except in the request header, and "Clear everything" deletes the server copy too.
- Knowledge notes never reach the server store; matching excerpts go only to the model provider with a message you send.
- The sandbox browser enforces the allowlist and public-address check on the main document and on every sub-request, blocks downloads, and runs with a fresh context per page.
- CSP on the production server restricts scripts and connections to the app origin; model output is rendered as text.

## Verification

```sh
npm test            # catalog weights, ledger and merge, roster, tool protocol, chat tool loop, orchestrator, streaming, shell worker
npm run test:server # proxy routing and SSRF, SQLite state routes, browse allowlist and a real Chromium inspection of a fixture page
npm run build
```
