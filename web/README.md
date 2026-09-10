# FreeToken Web × Ruflo

A browser-based multi-agent workspace with hosted inference and a unified streaming API proxy. End users open a URL; they do not install FreeToken, Python, CUDA, Node, or Ruflo on their computers.

## What is implemented

- Five-agent DAG: planner → researcher + architect (parallel) → reviewer → synthesizer.
- Browser-adapted **actual Ruflo Agent/Task domain entities**, lifecycle checks, dependency management, capability-based assignment, cancellation and bounded retries.
- Knowledge notes in IndexedDB, keyword retrieval, run history and exports.
- Header provider switcher and responsive right drawer.
- OpenRouter, Groq, native Cohere v2 streaming, and custom OpenAI-compatible APIs.
- Streaming agent output; model ID and provider tier in a compact bottom status bar. Tier labels are presets, **not measured latency benchmarks**.
- Per-provider settings and opt-in key persistence in localStorage; forget-all-keys action.
- Sanitized inline errors for unauthorized requests, rate limits, unavailable models, truncated streams and server failures.

**Boundaries:** The Python/CUDA FreeToken engine does not run in the browser. Serve it on hosted GPU infrastructure and configure its `/v1` endpoint as a custom provider. This app includes a portable subset of Ruflo, not the complete CLI/MCP/federation/AgentDB/self-learning runtime. Agents generate text; they do not run shell commands, edit remote repositories or browse websites. Demo mode is explicitly scripted, not AI inference.

## Install as an app (Chrome OS and desktop Chrome)

`public/manifest.webmanifest` plus the icon set in `public/icons/` make the deployed site installable: on a Chromebook, or in Chrome on Windows, Mac, or Linux, the address-bar install icon adds it to the shelf or dock, and Settings shows an **Install app** button whenever the browser offers the prompt (`src/pwa.ts` captures `beforeinstallprompt`). The manifest uses relative `start_url`, `scope`, and `id`, matching Vite's `base: './'`, so it works at the origin root or under a path prefix.

The build also emits `dist/sw.js`, a shell worker generated from `pwa/service-worker.js` by `pwa/build-worker.mjs`. It precaches `index.html`, the manifest, the icons, and every hashed script and stylesheet from the real bundle, so an installed app opens offline and the scripted preview still runs. It never intercepts `/api/*`, other origins, or non-GET requests; navigations are network first and fall back to the cached shell; hashed assets are cache first. The cache name hashes the template and the precache list, so each deploy purges the previous shell on activation. The worker registers only in production builds, and the server sends `Cache-Control: no-cache` for `index.html`, `sw.js`, and the manifest and `immutable` for hashed assets. The app shows an offline notice while `navigator.onLine` is false.

## Deploy (cloud server, not the visitor's device)

Requires Node 22+. From this `web/` directory, a deployment service runs:

```sh
npm ci
npm run build
npm start
```

Set `PORT` as required by the platform. `npm start` serves both `dist/` and `/api/*` from one origin. `npm run dev` also wires the same API handler into Vite. `npm run preview` uses the real server, not a static preview without APIs.

A `Dockerfile` and root-level `render.yaml` are included. Connect this branch to a Node/container hosting service, set `APP_ORIGIN` to its HTTPS URL, and deploy. **GitHub Pages or static-only hosting cannot run `/api/chat`.** A serverless adaptation must also support streaming responses and suitable timeouts.

No hosted deployment or production provider credentials are included. The code is ready for deployment; a cloud service must host it before visitors can use real inference.

## API contract

### `POST /api/chat`

```json
{
  "provider": "groq",
  "apiKey": "USER_KEY",
  "model": "groq/llama-3.3-70b-versatile",
  "messages": [{ "role": "user", "content": "Explain dependency graphs." }],
  "max_tokens": 1024
}
```

Supported provider values: `openrouter`, `groq`, **`cohere`**, `custom`.

| Provider | Upstream chat URL | Notes |
|---|---|---|
| OpenRouter | `https://openrouter.ai/api/v1/chat/completions` | `HTTP-Referer` = `APP_ORIGIN` (repository URL fallback); `X-Title` = `FreeToken Web`. Slugs are preserved. |
| Groq | `https://api.groq.com/openai/v1/chat/completions` | Optional `groq/` prefix is removed. Presets: `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`. |
| Cohere | `https://api.cohere.com/v2/chat` | Native SSE passes through unchanged; browser normalizes content-delta/message-end events. |
| Custom | `${baseUrl}/chat/completions` | Include the API version path, e.g. `https://inference.example/v1`. Origin must be approved server-side. |

Upstream SSE is piped directly with backpressure, no full-response buffering and `X-Accel-Buffering: no`. OpenAI-style chunks and native Cohere events are parsed incrementally in the worker. Client cancellation aborts proxy/upstream work. Request timeout: 120 seconds server / 125 seconds browser. Maximum request body: 256 KB; maximum output per request: 4,096 tokens. A workflow makes five normal calls, up to ten with retries.

`apiKey` is optional only for an unauthenticated approved custom endpoint or authorized server-funded access. To use environment credentials, send `serverAccessToken` matching `SERVER_CREDIT_ACCESS_TOKEN`. Keys are never automatically supplied to anonymous visitors. A supplied user key always takes precedence.

### `POST /api/models`

Accepts the same provider/key/baseUrl/access-token connection fields. Returns `{ "data": [{ "id": "..." }] }`. OpenRouter's public catalog can load without a key. Groq/custom use their `/models` endpoint; Cohere uses `/v1/models` and maps `name` to `id`. Users can always type any model ID. Presets do not guarantee that a model remains available on a provider account.

### `GET /api/providers`

Returns whether an administrator-approved Ollama bridge is configured. No provider keys or deployment access tokens are exposed.

## Server environment

See `.env.example`. Set environment variables in your hosting platform; environment files are not automatically loaded by `npm start`.

- `APP_ORIGIN`: public HTTPS app origin; used for origin checks and OpenRouter attribution.
- `CUSTOM_API_ORIGINS`: comma-separated exact HTTPS origins allowed for custom APIs.
- `OLLAMA_BRIDGE_URL`: exact administrator-approved base URL, including `/v1`.
- `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `COHERE_API_KEY`, `CUSTOM_API_KEY`: optional server credentials.
- `SERVER_CREDIT_ACCESS_TOKEN`: required authorization for using any server credential; keep strong, restricted and out of public bundles.

All provider environment variables stay server-side. Never prefix secrets with `VITE_`.

## Ollama: important network boundary

The preset is `http://localhost:11434/v1`. **From a hosted proxy, localhost means the hosting server, not the visitor's laptop.** This preset works only when an administrator explicitly configures that exact bridge and Ollama is reachable beside the proxy. For a browser-only end-user experience, deploy Ollama remotely and configure a secure, authenticated bridge. No arbitrary loopback/private-network proxying is enabled for public visitors. The app displays this limitation rather than silently pretending it can reach a visitor's computer.

## Security and privacy

- User keys travel over HTTPS to this deployment's proxy and then to the selected provider. The server does not persist or log them. Hosting operators must also disable request-body/header logging and require TLS.
- localStorage key saving is **opt-in and unencrypted**. Any same-origin script or successful XSS can read it. Prefer short-lived restricted keys on trusted devices. Turning persistence off and saving removes that provider's stored key; Forget All removes all saved keys. Workspace exports exclude connection keys and deployment access tokens.
- CSP on the production server restricts scripts and browser requests to the app origin; model output is rendered as text, not executable HTML.
- Custom origins are explicitly approved, public IPv4 DNS results are validated and pinned at connection time, redirects are not followed. Private/reserved addresses and IPv6 custom destinations are conservatively rejected. The configured bridge is the only deliberate administrator exception.
- Same-origin JSON requests, bounded inputs, sanitized upstream errors, and an in-process 60-request/minute peer-IP limit are implemented. Behind a reverse proxy the peer is usually the proxy itself; configure an appropriate edge rate limiter. This is not a replacement for deployment authentication, user quotas or a distributed abuse-control system.
- Do not configure a publicly accessible bridge that gives unauthenticated visitors access to sensitive services. Add gateway authentication/network controls for a production bridge.
- IndexedDB notes/history remain on the visitor's device. Closing/reloading the tab interrupts active workflows. Browser data eviction is possible; export important work.

## Verification

```sh
npm test
npm run test:server
npm run build
```

Tests use mocked upstream providers, not paid API calls. `tests/pwa.test.ts` boots the generated shell worker against a fake cache and checks precaching, API bypass, cache-first assets, and the offline navigation fallback. Coverage also includes routing, attribution, native Cohere events, SSE parsing, partial/truncated responses, error handling, key precedence, server-credit authorization, SSRF restrictions, graph execution, retries and cancellation. Chromium checks also covered provider switching, opt-in key persistence/reload/removal, missing-key failure recovery and a 390-pixel responsive viewport. Real paid provider inference has **not** been tested without user credentials.

## Source and licenses

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Original FreeToken files are unchanged; this web edition is additive under `web/`.
