# Signal Forge OS Web Edition

A browser workspace with streaming chat, five-stage workflows, a model hub, a Knowledge Hub,
read-only GitHub and web connectors, and optional browser inspection. The frontend is React
and Vite; the proxy is a long-lived Node 22 service. Static hosting alone cannot serve its API.

The live Render test app is https://hey-buddy-web.onrender.com. Owner funding is disabled;
visitors can use their own provider keys. Read the [root README](../../README.md) for the
current funding defenses, cost-bound configuration and USB limitations, and
[Render setup](../../docs/render-setup.md) for owner access and deployment details.

Admin → Backend connections controls the US group and a separate optional Hugging Face
backend. The HF connection accepts its router or an existing official dedicated chat endpoint,
with an owner-configured model name. It has its own `HF_BACKEND_API_KEY`; Experiment's
`HF_TOKEN` is never reused. Availability switches block personal-key and managed traffic without
deleting keys. The router uses a provider catalog; dedicated model lists are explicitly configured.
Hub repositories are model files, not a running inference service. See the root README for setup.

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
