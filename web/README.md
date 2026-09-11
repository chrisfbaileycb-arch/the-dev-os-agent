# Hey Buddy, web edition

A browser workspace for one person or a small business: a chat with a business agent, three multi-agent workflows, a connectors hub, a knowledge hub that stays on the device, a model hub, a credit ledger, and a sandboxed browser agent. Runs on a Chromebook or any modern browser, installs as an app, and needs no account.

**Zero-config by default.** On a deployment with server provider keys, a first-time visitor types a prompt and gets a live streaming reply — no sign-up, no API key, nothing to configure. The server funds an allowlisted set of free models from its own Groq and OpenRouter keys and meters every request against a visible credit quota. Bring your own key to unlock deep-reasoning models and drop the quota entirely.

Inspired by FreeToken Web, Ruflo, AnythingLLM, LobeHub, and Cherry Studio. Original code and prompts; the Apache and MIT notices for the FreeToken and Ruflo code carried in this directory are in `THIRD_PARTY_NOTICES.md`.

## What is in the box

- **Workspace.** Sessions on the left, one conversation canvas scrolling top to bottom, and a floating prompt dock pinned to the bottom of the viewport. The dock carries an auto-expanding textarea, one attach button for files and photos (drag, paste, or click), a microphone toggle (Web Speech API where the browser has it), the agent picker, the mode picker, the model dropdown with its free/your-key badge, the connectors button, and live token counters. Enter sends; Shift+Enter breaks a line. On a phone the chip labels collapse to icons, the row wraps, and the send button stays under the thumb. Photos are resized in the browser (1280 px, JPEG) and sent as image parts to a vision model; a small thumbnail stays in the session.
- **Multi-agent pipeline strip.** A running workflow reports as one compact horizontal strip of stage badges above the output — Plan, Research, Design, Review, Write — with exactly one stage's text underneath. Click a badge to read that stage; a finished run folds itself to a single line so the conversation stays readable.
- **Agent roster.** Operational Executive, Financial Auditor, Content and Reputation Specialist, and the Browser Agent lead a chat. Dispatcher, Researcher, Architect, Reviewer, and Scribe run the workflows *Plan it*, *Look into it*, and *Check my work* as a five-stage dependency graph on browser-adapted Ruflo entities, in the lead agent's focus. Every prompt starts with the same safety baseline (`src/lib/roster.ts`).
- **Knowledge hub.** Notes and imported text files in IndexedDB, retrieved by keyword and attached to messages and runs. Never sent to the server store.
- **Model hub, three ways to pay.** The dropdown on the dock leads with the *zero-config* group — `groq/llama-3.3-70b-versatile`, `groq/llama-3.1-8b-instant`, `openrouter/auto`, and OpenRouter's free pool — which need no key at all when the deployment has provider keys. Below it sit the deep-reasoning models (Claude 3.5 Sonnet, DeepSeek R1, GPT-4o), shown but marked locked until you add your own OpenRouter, Groq, or custom key in Settings. *Platform credits* is the third mode: the full pool behind an administrator access token. A key-only model picked with no key opens Settings and says what is missing rather than failing on send.
- **xKiro gateway.** One OpenAI-compatible endpoint (`https://api.xkiro.com/v1`) fronting DeepSeek, GLM, Qwen and Kimi, wired as a first-class provider: set `XKIRO_API_KEY` (and optionally `XKIRO_BASE_URL`) and its pool funds the zero-config tier on its own, no Groq or OpenRouter account needed. Because a gateway's catalogue is its own to define and moves faster than this repo, the shipped ids are a **seed, not a contract**: `XKIRO_FREE_MODELS` replaces them wholesale from the dashboard, the dock's Discover button reads the real list from `/v1/models`, and the dropdown renders any model `/api/providers` reports even if this build has never heard of it. A wrong model id is therefore an env edit, never a redeploy.
- **Plans page and the xKiro referral.** A three-card view (`src/ui/Pricing.tsx`) reachable from the rail. Only the Free card is a Hey Buddy plan — the app has no billing, takes no payment and has no account to upgrade — so the Pro and Ultimate cards say plainly that they are *xKiro's* plans: you buy a key there and paste it in here. That wording is load-bearing, not decoration: a visitor who pays xKiro believing they upgraded Hey Buddy has been misled. Every outbound link goes through `src/lib/referral.ts`, which supplies `target="_blank" rel="noopener noreferrer"` centrally so no call site can forget them, and renders an FTC-style disclosure beside each one. Setting `REFERRAL_URL` to an empty string removes every referral link and callout from the UI. The advertised free-token figure is a third-party claim this project cannot verify; it lives in that same file as editable copy and is attributed to xKiro wherever it appears.
- **Zero-config tier, enforced on the server.** Which models a keyless visitor may run is a hard allowlist in `server/freetier.mjs`, matched exactly — no prefix, namespace, or case trick reaches a paid model. `openrouter/auto` is never forwarded to OpenRouter's paid router: the proxy substitutes a concrete `:free` model and passes the rest of the pool as fallbacks. Output is capped at `FREE_MAX_OUTPUT_TOKENS` whatever the browser asks for.
- **Graceful degradation when the tier cannot serve.** Keys unset, provider rate-limiting, upstream down — all three look identical from a keyless browser and none is the visitor's key to fix, so all three produce one message: *"Public free tier warming up — enter your own key in Settings or try again shortly."* An upstream 401 on a server-funded request is deliberately **not** reported as "invalid API key", which would send the visitor hunting for a fault that is not theirs; the real status stays in the operator's logs. The proxy tags each refusal with a code (`free_tier_unavailable`, `free_tier_busy`, `free_tier_exhausted`, `key_required`) so the browser branches on cause rather than on prose, and a test compares the server and client strings so the wording cannot drift.
- **A key always wins.** Supplying your own key overrides the server's funding for every model, including the free ones. A free model this deployment does *not* fund still runs on your key rather than routing through a tier that would strip it — `inferenceFor()` decides from the funded list reported by `/api/providers`, not from the model id alone.
- **Credit ledger.** Every request is logged with tokens and credits: fast models 0.5 credits per 1K tokens, standard 3, reasoning 15; BYOK and the scripted preview log at zero. Free-tier usage is measured **on the server**, from the bytes that actually crossed the wire (`server/meter.mjs` reads the provider's own `usage` block and falls back to a byte estimate), so a browser cannot under-report what the deployment paid for; the free allowance and the credit pool are separate budgets. The status bar shows the model, payment mode, time to first token, output speed, remaining credits, whether a background worker is online, and sync state.
- **Browser Agent.** `POST /api/browse` opens one public page in headless Chromium and returns title, description, canonical, robots, headings, social tags, visible text, and links. Guardrails: an explicit host allowlist (`BROWSE_ALLOWED_HOSTS`), public IPv4 only (re-checked on every request the page makes), no downloads or credentials, timeouts, and a per-workspace hourly budget. The agent asks for it with a single `TOOL {...}` line; at most three calls per message.
- **Connectors hub.** One expandable menu on the dock, four kinds of reach, each switchable on its own. Every call shows as a trace under the reply.
  - **GitHub** — `github_repo` (metadata, README, or any text file), `github_files` (the file listing), `github_issues` (recent issues, or one issue with its comments). Read-only *by construction*: the upstream method is hard-coded to GET and the route only builds URLs from a closed operation map, so a token pasted here cannot become a commit or a comment. Optional personal access token raises GitHub's limit from 60 to 5,000 calls an hour and reaches private repositories.
  - **Web scraping and URL crawler** — `fetch_url` takes a text snapshot of any public URL through `POST /api/fetch`, which is how the browser reads external pages at all: CORS forbids it doing this itself. A plain GET, no JavaScript, no cookies; the resolved public IPv4 is pinned for the connection so a name cannot rebind between the check and the request, redirects are re-validated at every hop, and the body is capped at 1.5 MB. This is deliberately *not* the Browser Agent, which runs real Chromium and stays behind an allowlist.
  - **File and document knowledge hub** — drag and drop text, Markdown, CSV, JSON, or HTML straight into the local index, and `search_documents` lets an agent go looking for a document the message did not surface. Bounded lexical scoring, held in IndexedDB: honest keyword retrieval, no embeddings and no vector database.
  - **Custom MCP** — remote Model Context Protocol servers over Streamable HTTP (name, https URL, optional bearer token). `POST /api/mcp` runs the initialize handshake, keeps the session id, and forwards `tools/list` and `tools/call`; every tool on an enabled server becomes a chat tool named `<server>.<tool>`. Guardrails: https and public hosts only, no redirects, bounded responses, `MCP_MAX_PER_HOUR` per workspace. Tokens stay in memory unless remembered.
- **Persistence.** Sessions, runs, and the ledger are saved in IndexedDB and mirrored to SQLite on the server (`server/db.mjs`, Node's built-in `node:sqlite`) under an anonymous workspace id the browser mints. A refresh, a reinstall, or a cleared cache keeps history and balances as long as the id survives in localStorage; there are no accounts.
- **Dual-service ready, single-service by default.** The deployed topology is one Node web service: SSE streaming and agent tasks are consolidated there, and workflows run in the visitor's own browser Web Worker. The backend also supports a second Render Background Worker that claims heavier multi-step runs over the private network and posts results back (`server/jobs.mjs`, `server/worker.mjs`) — it is written and tested, but no worker service is deployed, so `/api/jobs` reports `worker: false` and the queue stays idle. Adding one later needs no rewrite. Queued jobs sit on disk until claimed, so the queue accepts zero-config runs only and refuses anything carrying a key.
- **Installable.** Web app manifest, Hey Buddy's icon set, an Install button in Settings, and a shell service worker generated at build time so an installed app opens offline (the scripted preview keeps working; hosted models need a connection).

## Run locally

Requires Node 22.

```sh
npm ci
npx playwright install chromium   # only for the Browser Agent and its test
npm run dev                       # Vite with the API, workspace store, and every connector route wired in
npm test && npm run test:server   # unit tests, then server tests (free tier, proxy, SQLite, connectors, jobs)
npm run build && npm start        # production server on PORT (default 4173)
npm run worker                    # optional background worker; needs WEB_SERVICE_URL and WORKER_TOKEN
```

To see the zero-config tier locally, export a real `GROQ_API_KEY` or `OPENROUTER_API_KEY` before `npm run dev` and open the app in a private window: the dock should already show a free model, and the first prompt should stream with nothing entered in Settings.

## Deploy

The server streams provider responses as Server-Sent Events and keeps a SQLite file, so the host must run a long-lived Node process with a writable disk. Static hosting cannot serve `/api/chat`.

- **Render (recommended).** The root `render.yaml` provisions both services: a Docker web service with a 1 GB disk at `/data`, and an optional Node background worker sharing a generated `WORKER_TOKEN`. Leave `APP_ORIGIN` unset — the server already matches the request origin against its own host, and a wrong value makes every API call fail with 403. Set `GROQ_API_KEY` or `OPENROUTER_API_KEY` in the dashboard to switch the free tier on; set `BROWSE_ALLOWED_HOSTS` if you want the Browser Agent. Delete the worker block if you do not want a second service.
- **Docker anywhere.** `Dockerfile` builds on `mcr.microsoft.com/playwright`, so Chromium is present for the Browser Agent. Mount a volume at `/data`.
- **Any Node host without Chromium.** `/api/browse` answers 503 and the rest of the app works.

## Environment

See `.env.example`.

| Variable | Purpose |
|---|---|
| `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `XKIRO_API_KEY` | Fund the zero-config free tier. Set any one and keyless visitors get live replies; leave all unset and the app opens in the scripted preview. Keys stack — the pools combine. |
| `XKIRO_FREE_MODELS` | Comma-separated xKiro ids to offer free, replacing the shipped seed. Set it to what the gateway actually serves. |
| `XKIRO_BASE_URL` | The gateway base, default `https://api.xkiro.com/v1`. HTTPS only; a malformed value falls back to the default rather than failing the tier. |
| `FREE_CREDIT_MONTHLY_POOL` | Free credits per workspace per month at 0.5 per 1K tokens (default 400 ≈ 800,000 tokens). |
| `FREE_MAX_PER_HOUR` | Per-IP burst cap on keyless requests (default 40). The workspace id is browser-minted, so this is what bounds total spend. |
| `FREE_MAX_OUTPUT_TOKENS` | Output ceiling for a server-funded reply (default 1,024), applied whatever the browser asks for. |
| `FREE_TIER_DISABLED` | `true` switches the tier off without removing the provider keys. Visitors then see the same warming-up message as an unfunded tier. |
| `APP_ORIGIN` | Optional. Pins one external origin; leave unset on Render. Also used for OpenRouter attribution. |
| `DATA_DIR` / `DATA_FILE` | Where the SQLite file lives. Put it on a persistent disk. |
| `CREDIT_MONTHLY_POOL` | Platform credits per workspace per calendar month (default 100,000). Separate budget from the free tier. |
| `FETCH_ALLOWED_HOSTS`, `FETCH_MAX_PER_HOUR` | URL crawler scope (empty means any public host) and budget (default 60). |
| `GITHUB_TOKEN`, `GITHUB_MAX_PER_HOUR` | Optional server token for the GitHub connector, and its hourly budget (default 120). |
| `BROWSE_ALLOWED_HOSTS` | Hosts the sandbox browser may open. Empty disables it; `*` allows any public host. |
| `BROWSE_MAX_PER_HOUR` | Per-workspace page budget (default 30). |
| `MCP_MAX_PER_HOUR` | Per-workspace budget for MCP calls (default 120). |
| `CUSTOM_API_ORIGINS`, `OLLAMA_BRIDGE_URL` | Approved custom endpoints and an administrator bridge to a home model server. |
| `SERVER_CREDIT_ACCESS_TOKEN`, `COHERE_API_KEY`, `CUSTOM_API_KEY` | Server keys used only for requests carrying the access token (platform credits). |
| `WORKER_TOKEN` | Shared secret between the web service and the background worker. Unused without a worker. |
| `WEB_SERVICE_URL`, `WORKER_POLL_MS` | Worker service only: the web service's internal address and poll interval. |

## API

- `POST /api/chat` streams SSE from OpenRouter, Groq, Cohere, or an approved custom endpoint. Funding is decided server-side in this order: the visitor's own key, then the administrator access token, then the zero-config allowlist; nothing else is funded (`fundingFor` in `server/proxy.mjs`). `POST /api/models` lists models. `GET /api/providers` reports the free tier this deployment can fund and any Ollama bridge — it never returns a key, and answers 200 with nothing configured, which is why it is the health check.
- `GET /api/state` returns the workspace's sessions, runs, ledger, credit pool, and free allowance; `GET /api/state/usage` is a cheap read of just the budgets plus the newest server-metered row; `POST /api/state` upserts; `POST /api/state/clear` deletes. Requires `X-Workspace-Id`.
- `POST /api/fetch` with `{ "url": "https://..." }` returns a text snapshot: title, description, headings, readable text, and links.
- `POST /api/github` with `{ "operation", "params", "token"? }` runs one read-only GitHub call. Operations: `repo`, `readme`, `tree`, `file`, `issues`, `issue`, `comments`.
- `POST /api/jobs` enqueues a background workflow and `GET /api/jobs?id=…` polls it (both need `X-Workspace-Id`); `GET /api/jobs` alone reports whether a worker is online. `POST /api/jobs/claim`, `/update`, and `/finish` are the worker's side and need `Authorization: Bearer $WORKER_TOKEN`.
- `POST /api/browse` with `{ "url": "https://..." }` returns a page report or a 4xx/5xx with a plain message.
- `POST /api/mcp` with `{ "url", "method": "tools/list" | "tools/call", "params", "authorization"? }` forwards one JSON-RPC call to a remote MCP server and returns its `result`.
- `/api/chat` messages may carry OpenAI-style content parts: text plus up to five bounded `image_url` parts (data URLs or https). Native Cohere refuses image parts.

## Security and privacy

- Provider keys travel over HTTPS to this proxy and on to the provider; the server never stores or logs them. The optional "remember key" setting uses unencrypted localStorage on the device. A zero-config request carries no secret at all — the browser strips both the visitor key and the deployment token before sending.
- The zero-config tier spends the deployment's own money, so it is bounded in four independent ways: an exact model allowlist, a server-measured monthly credit quota per workspace, a per-IP hourly burst cap, and an output-token ceiling. Be aware of the honest limit: the workspace id is minted by the browser and can be rotated, so the monthly quota alone does not bound total spend — the per-IP cap does, and a deployment expecting real abuse should sit behind a CDN or add authentication.
- The GitHub connector cannot write. Its upstream method is hard-coded to GET and it only builds URLs from a closed operation map, so a token pasted into it cannot be turned into a commit, a comment, or a request to any other host.
- The URL crawler resolves the target, checks the address is public IPv4, and pins that address for the connection, so a hostname cannot rebind to a private address between the check and the request. Redirects are followed manually and re-validated at every hop.
- Background jobs are stored on disk until a worker claims them, so the queue refuses any request carrying an API key or access token; runs on your own key stay in your browser.
- The workspace id is a bearer of its own data: anyone holding it can read that workspace's sessions from the server. It never leaves the browser except in the request header, and "Clear everything" deletes the server copy too.
- Knowledge notes never reach the server store; matching excerpts go only to the model provider with a message you send.
- The sandbox browser enforces the allowlist and public-address check on the main document and on every sub-request, blocks downloads, and runs with a fresh context per page.
- CSP on the production server restricts scripts and connections to the app origin; model output is rendered as text.

## Verification

```sh
npm test            # catalog weights, ledger and merge, roster, tool protocol, chat tool loop, orchestrator, streaming, shell worker
npm run test:server # free-tier allowlist and metering, proxy routing and SSRF, image parts, SQLite state routes,
                    # connector extraction and guardrails, job queue and worker stages, browse allowlist with a
                    # real Chromium inspection, MCP handshake against a fake server
npm run build
```

The free tier has its own suite (`tests/freetier.test.mjs`). One test reads `src/lib/catalog.ts` and compares its zero-config ids against `FREE_MODELS` literally, so the build fails if the dropdown ever offers a model the server would refuse to fund. Others assert that a keyless request streams only for an allowlisted model, that `openrouter/auto` never reaches the paid router, that the ledger is billed from the streamed bytes, and that an exhausted quota or a tripped burst cap is refused before any upstream call.
