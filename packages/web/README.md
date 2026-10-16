# Signal Forge OS Web Edition

A browser workspace with streaming chat, five-stage workflows, a model hub, a Knowledge Hub,
read-only GitHub and web connectors, and optional browser inspection. The frontend is React
and Vite; the proxy is a long-lived Node 22 service. Static hosting alone cannot serve its API.

The live Render test app is https://hey-buddy-web.onrender.com. Owner funding is disabled;
visitors can use their own provider keys. Read the [root README](../../README.md) for the
current funding defenses, cost-bound configuration and USB limitations, and
[Render setup](../../docs/render-setup.md) for owner access and deployment details.

Admin → Backend connections controls the US group (OpenAI, Anthropic, Google, Groq, xAI).
Availability switches block personal-key and managed traffic without deleting keys. The optional
Hugging Face backend was removed; the Experiment connection (`HF_TOKEN`, personal-key-only) is
unaffected. See the root README for setup.

## Execution and storage

- The tool-enabled chat loop permits three model requests and two tool calls per message. Each workflow has five
  fixed stages, with at most three attempts per stage and fifteen client requests overall.
  Browser limits are independent of the server's request and spending controls.
- Personal provider keys stay in page memory and clear on reload. A supplied personal key
  takes priority over free or plan funding, including a legacy client funding preference.
- Experiment requests carry `X-Forge-Is-Experimental: true`. The server checks that flag,
  metadata and provider classification before routing; a personal key is required. Stored
  owner keys and plan access tokens cannot fund an Experiment route.
- Knowledge documents live in IndexedDB. Matching excerpts are sent with model requests.
  IndexedDB is not an encrypted hardware vault. File import can copy text documents from
  a USB drive; direct WebUSB storage needs a compatible device and a reviewed protocol.
- Sessions, runs and credit history can be mirrored into Postgres or SQLite. Server state and
  job APIs require a signed workspace cookie or configured OAuth identity, not just a UUID.
  SQLite under `/tmp` is transient. The daily USD ledger is separate from workspace clearing.
- The live service has Postgres but no Chromium or background worker. `/api/browse` needs
  Chromium and a host allowlist; server jobs remain transient and cannot claim resumability.
  Browser workflows run in the visitor's Web Worker.

## Run locally

Run these commands from this package, or use the root workspace scripts:

```sh
npm ci
npm run dev
npm test
SKIP_UPSTREAM_TESTS=1 npm run test:server
npm run build
npm start
```

Node 22 or newer is required. `npx playwright install chromium` enables optional local
browser inspection tests. The server listens on `PORT`, default 10000. A local server without
Chromium returns 503 for browser inspection; other connectors remain available.

Live gateway discovery tests only retrieve model metadata. `SKIP_UPSTREAM_TESTS=1` skips
them when network access is unavailable. Unit tests use synthetic keys and cost bounds;
those fixtures are not real provider prices and must never configure a deployment.

## Funding configuration

Owner-funded inference requires durable storage, a positive `DAILY_SERVER_BUDGET_USD`,
reviewed `MANAGED_MODEL_COST_BOUNDS_JSON`, an approved model/provider route, output caps,
and an enabled funding policy. Missing or invalid configuration fails closed. The Render
test environment keeps the daily cap at zero and `OPERATOR_FUNDING_DISABLED=true`.

Reservations include the reviewed full input ceiling, maximum output including reasoning,
and request fees. Every upstream retry reserves again, with at most three attempts. Failed,
unknown or incomplete responses retain the whole reservation. Only complete provider usage
qualifies for one settlement; usage outside the bounds freezes the day. Provider-side key
limits remain necessary if vendor prices or billing semantics change.

The anonymous limiter stores salted IP + User-Agent fingerprints and a companion IP quota
in a bounded, nonpersistent rolling-hour cache. Recent quotas are not evicted to admit new
clients. It uses the observed socket IP, ignoring untrusted forwarding headers; a reverse
proxy may therefore share one conservative limit among visitors. It resets on process restart.
The shared database daily cap does not reset on restart.

`FREE_MAX_OUTPUT_TOKENS` bounds free replies regardless of client requests. Smaller explicit
settings, including 1,024 and 8,192, are retained. `FREE_MAX_PER_HOUR` defaults to 40 and is
bounded at 1,000. Monthly credits support product quotas; they are not dollar accounting.
For the complete current schema and configuration examples, use the root README.

xKiro discovery accepts only explicit `access_tier: "free"` entries with zero input and output
prices. `XKIRO_FREE_MODELS` narrows that live pool; it cannot supply models before discovery.
Matching is case insensitive and returns the canonical gateway ID, preserving punctuation.
xKiro is an unknown relay and does not become an approved operator route through discovery.

## API and connectors

- `POST /api/chat` streams model responses; `POST /api/models` lists models. Provider keys,
  routes and budgets are resolved server-side. `GET /api/providers` publishes safe model
  capabilities; `GET /api/health` reports storage, deployed commit, identity and funding policy.
- `/api/workspace/session` issues anonymous workspace proof. `/api/state`, `/api/state/usage`
  and `/api/state/clear` require ownership. Client credit entries cannot fund a provider request.
- `/api/admin/*` manages sealed owner settings, keys and tiers. Initial setup requires a
  Render bootstrap secret and a password of at least twelve characters. Remove the bootstrap
  variable after setup. Keep `SESSION_SECRET` and `SETTINGS_SECRET` stable across redeploys.
- `POST /api/github` only supports closed, read-only operations. `POST /api/fetch` fetches
  bounded text from public addresses, with pinned DNS and rechecked redirects.
- `POST /api/browse` uses a fresh Chromium context, public-address checks and
  `BROWSE_ALLOWED_HOSTS`; it blocks downloads and credentials.
- `POST /api/mcp` forwards bounded remote MCP calls to public HTTPS hosts. Imported skills
  and connector descriptions do not grant execution or spending permissions.
- The Jev System-1 Router is a first-party **skill**, not a route: it carries the operational
  understanding of the router pattern (typed Choice/Score/Noul decision graphs) as instructions
  a model reasons with. There is no key, no server call, and no third-party egress. Turning the
  skill on or off is the whole control surface.
- `/api/jobs` supports an optional worker protocol. No worker is deployed. Jobs refuse
  requests carrying personal API keys or access tokens.

The root `render.yaml` creates a free Node test service plus a free Postgres test database.
It is not automatically applied to the existing service. The live service builds through
`web/package.json`, a compatibility bridge to this package. Its main-branch auto-deploy is
configured in Render. Docker and worker files remain available for separately reviewed setups.

## Verification and remaining work

Run frontend tests, hermetic server tests and a production build before release. The budget
suite checks concurrent requests, retained retry charges, UTC reset, idempotent settlement,
reopening, cache churn, experimental isolation and discovery normalization. Workflow tests
exercise three attempts at every stage and a recursively requesting tool response.

Production repository execution still needs an isolated sandbox, server-owned action approvals,
reviewed provider adapters and durable resumable jobs/artifacts. The current deployment does
not execute arbitrary repositories or expose hardware storage through a server browser.

See [monthly plan setup](../../docs/monthly-plans.md) for the existing manual activation flow.
Plan credit allowances do not override the global USD gate or permit Experiment funding.

## Phase 3: tool directory, sandbox, and runtime exports

The workspace opens with the developer conversation on the left and two execution tabs on the right: **App Live Preview** and **Agent Sandbox / DevOps Console**. The generated React app uses the isolated preview runtime and its own error boundary; the host has a separate view boundary. The compiler and tool runtime use different workers.

`src/lib/mcpServers.ts` contains 25 distinct integrations across developer, infrastructure, research, business, runtime, and optional media categories. Hugging Face inference stays in Settings/Admin. Local filesystem, SQLite, Docker, Brave, Puppeteer, Playwright, Tavily, and Resend entries contain explicit HTTPS bridge setup guidance rather than invented hosted endpoints. Configure a bridge that you control with a directory/database/tool allowlist. OAuth-only remote servers require an authorized access token or an authenticated bridge; this application does not claim to implement provider-specific OAuth registration. Exa API keys use `x-api-key`; other MCP credentials use the configured authorization header. The custom MCP/REST/WebSocket form remains visible at the bottom of the directory, and configurations persist in LocalStorage. Credentials are session-only.

Tool calls run in a dedicated, short-lived Web Worker via a versioned message protocol with per-call ID and nonce validation. The worker receives only the selected capability and the credential it needs, executes known adapters without evaluating model-authored JavaScript, and terminates on completion, failure, timeout, or cancellation. The MCP proxy binds sessions to signed workspace ownership and credential identity. External MCP actions are reviewed before dispatch; Plan uses its existing per-action approval dialog. Remote job cancellation cannot undo a job already submitted to its provider.

Enable **HeyGen** or **Nano Banana** in Connectors → MCP & Tools with your own provider key. HeyGen uses the v3 avatar-video API and needs avatar/voice IDs, supplied as defaults or tool arguments. It returns a job manifest; `heygen_video_status` retrieves a completed video URL. Nano Banana uses Google's stateless Interactions API with an explicitly selected image model. Both are optional tool adapters and are independent of coding inference and compilation. Generations require approval and are never automatically retried. The app does not use ENV keys as media fallbacks. No new Render environment variables or services are required.

The console displays live skill/step outputs, connector targets, full argument payloads and tool stdout, elapsed duration, trapped errors, and media artifacts. Execution events and artifacts are stored only in IndexedDB; they are excluded from cloud synchronization and are removed when their session or workspace is deleted. Reloading marks unfinished local execution events as interrupted.

**Export Agent** in both the console and Agent Skills downloads a complete JSON or YAML definition with persona, system prompts, active skills and supporting resources, MCP schemas, and optional browser memory. Credentials and credential-bearing URL parameters are removed. **Download Execution Bundle** includes both agent formats, `execution-log.json`, `transcript.md`, every recorded generated file version (including SQL/JSON), edited project files, compiled preview HTML, binary images, video manifests, and an artifact manifest. The transcript contains user-visible step outputs and tool responses; private model reasoning is not collected. Tool-written files are included when their content is returned by the tool, or when the tool returns an embedded resource. A remote filesystem tool's path-only acknowledgement cannot provide file bytes; read that file through its connector before exporting it. Download URLs in video manifests may expire at the provider.

Archives preserve binary bytes and CRCs and reject unsafe or duplicate paths rather than silently dropping files. Explicit resource limits fail the operation with an actionable error; skill definitions, schemas, stdout, and exported files are never silently shortened by the new pipeline.
