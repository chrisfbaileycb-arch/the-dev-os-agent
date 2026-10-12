# Signal Forge OS, web edition

A React/Node workspace with chat, five-stage agent workflows, local knowledge and memories,
full attributed skills, a generated-app preview, and optional read connectors.

Live test host: **https://hey-buddy-web.onrender.com**. Render auto-deploys GitHub `main`.
Application code is in `packages/web/`; the root `web/` package is a Render build bridge.
See [owner setup and deployment details](docs/render-setup.md).

The current deployment uses Postgres for server state and settings, signed workspace cookies,
owner bootstrap protection, and `/api/health` monitoring. Owner-funded inference is **disabled**.
Visitors can use their own provider keys in Settings or an explicitly enabled local model server.
Personal keys stay in page memory and clear on reload; never include them in prompts or skills.

## Optional backends

Admin → **Backend connections** has independent US and Hugging Face availability switches.
The US group contains OpenAI, Anthropic, Google, Groq and xAI. Switching a group off blocks its
personal-key and managed requests at the proxy; it retains stored keys and model selections.
Availability does not enable owner spending or silently substitute a different backend.

The separate `huggingface-backend` connection uses `HF_BACKEND_API_KEY`, never the Experiment
tab's `HF_TOKEN`. `HF_BACKEND_ENABLED=true` makes it available; `US_BACKEND_ENABLED=false`
disables the US group. These nonsecret switches can also be saved in Admin. Hugging Face stays
outside Shield and is not a US-only routing guarantee. All funded calls still need tier approval,
durable cost reservations and an enabled spending policy; this test host still has a zero budget.

With `HF_BACKEND_BASE_URL` blank, it uses `https://router.huggingface.co/v1` and discovers the
router's available models. This route does not request account-profile access. For an existing
dedicated chat endpoint, set its official HTTPS `endpoints.huggingface.cloud` URL (with `/v1`)
and put its exact endpoint model name in `HF_BACKEND_MODELS`. That list is owner-configured;
listing it does not validate a token or invoke paid inference. Browser-supplied URLs cannot
redirect this backend. Use a Hugging Face token scoped for the required inference route.

An uploaded Hub repository alone is not a running inference endpoint. This update connects
existing services; it does not download model weights or provision new GPU/endpoint hosting.
OpenRouter and the original Hugging Face Experiment connection remain personal-key-only.

## xKiro Gateway & Discovery Protocol

- **Dynamic discovery:** the server reads `GET {base}/models` at boot and refreshes its cached
  catalogue on demand after one hour. xKiro's discovered free subset requires both
  `access_tier: "free"` and explicit numeric or numeric-string zero input/output prices.
  Missing, null, boolean, blank and nonzero pricing is rejected.
- **Drift protection:** `XKIRO_FREE_MODELS` narrows the live discovered free subset. A cold or
  empty catalogue admits nothing. Matching ignores casing and surrounding whitespace while
  preserving `/`, `-`, `.`, `_` and `:`; punctuation is not deleted or prefix-matched.
  Outbound requests use the gateway's canonical ID. A failed refresh retains the last good
  catalogue and retries after a minute; cached metadata is not a permanent price guarantee.
- **Funding policy:** discovery is catalogue information, not permission to spend. The operator
  US backend permits OpenAI, Anthropic, Google, Groq and xAI. The separate optional Hugging Face
  backend requires an explicit switch, credential and approved tier/cost bounds; the Experiment
  Hugging Face route, xKiro and OpenRouter remain excluded from funded pools. A provider's headquarters does not
  establish the model developer's nationality, processing region, or data-retention terms.
- **Experimental isolation:** Experiment chat and discovery requests send
  `X-Forge-Is-Experimental: true`. The proxy also recognizes `experimental: true` metadata and
  the OpenRouter/Hugging Face provider IDs, so omitting the header cannot enable those routes.
  Without a personal key it returns HTTP 401, `key_required`, before discovery or routing.
  Server access tokens and stored owner keys cannot substitute for the personal key. Experiment
  providers are excluded from `shieldProviders()` and funded free/paid model lists.

## Financial Defenses & Graceful Degradation

- **Personal-key priority:** a supplied valid personal key always wins over a plan token or a
  funded model match. It never silently falls back to the operator's key after a provider failure.
- **Token capping:** `FREE_MAX_OUTPUT_TOKENS` caps funded free replies on the server. Explicit
  smaller caps, including 1,024 and 8,192, stay in effect. Browser parameters cannot raise them.
- **Rolling rate limits:** `FREE_MAX_PER_HOUR` limits hashed server-observed IP + User-Agent
  fingerprints and the IP alone over the preceding hour. Changing User-Agent or a workspace
  header does not reset the IP allowance. The salted cache has at most 10,000 entries and fails
  closed when full; it stores no raw fingerprint and resets with the process. Behind a proxy,
  the observed peer may represent several visitors; untrusted forwarding headers are ignored.
  Fingerprints are an abuse speed bump, not durable identity or the dollar spending boundary.
- **Daily USD cap:** all operator-funded chat attempts, free and paid-plan alike, must atomically
  reserve cost against `DAILY_SERVER_BUDGET_USD` in the shared database before dispatch. The cap
  resets by UTC dispatch day. Missing/invalid/zero caps deny funded work with
  `free_tier_exhausted`. Non-durable storage, missing cost bounds or unknown routes fail closed.
  Workspace clearing and web-service restarts do not reset the separate USD ledger.
- **Concurrency and retries:** pending reservations count against the cap immediately, across
  processes sharing Postgres. Each credential retry reserves separately; at most three upstream
  attempts are allowed per proxy request. Interrupted/failed/unmetered attempts retain their
  full reservation. Only a fully drained completion with valid provider-reported input/output
  usage qualifies for reconciliation; repeated settlement cannot refund twice. Usage above
  approved bounds freezes the shared day's allowance.
- **Bounded execution:** each workflow stage permits at most three model calls, including
  retries; five stages permit at most fifteen. The tool-enabled chat loop permits three model calls and
  two tool calls. These browser limits improve normal execution; a modified client still faces
  the independent server quotas and USD reservations.
- **Stable error shape:** failures return `{error: {message, code}}`. Keyless paths use
  `free_tier_unavailable`, `free_tier_busy`, or `free_tier_exhausted`; upstream credential bodies
  are not returned to the browser. The hosting emergency stop returns `operator_funding_disabled`.
  Error codes do not claim that credits are equivalent to dollars.

### Required managed-cost configuration

| Environment variable | Meaning |
| --- | --- |
| `OPERATOR_FUNDING_DISABLED` | Hosting-controlled emergency stop; currently `true`. |
| `DAILY_SERVER_BUDGET_USD` | Shared daily USD ceiling, at most 10,000; currently `0`. |
| `MANAGED_MODEL_COST_BOUNDS_JSON` | Reviewed route bounds; currently `[]`, so no route is approved for spending. |
| `FREE_MAX_PER_HOUR` | Rolling network/fingerprint quota, default 40, maximum 1,000. |
| `FREE_MAX_OUTPUT_TOKENS` | Server reply cap, default 16,384, range 64–65,536. |
| `FREE_CREDIT_MONTHLY_POOL` | Separate monthly credit allowance; currently `0`. |
| `FREE_TIER_DISABLED` | Free-tier switch; currently `true`. |

Each cost-bound entry identifies the exact outbound `provider` and `model` and supplies
`inputUsdPerMillion`, `outputUsdPerMillion`, `requestUsd`, `maxInputTokens`, and
`outputIncludesReasoning: true`. These are operator-reviewed **upper bounds**, not browser
prices or inferred catalogue labels. The input ceiling must cover the provider's full supported
input context and all billable cache/input variants; output pricing must cover reasoning tokens
within the enforced generation limit. Include any fixed request fees. Unknown pricing, additional
modalities, and unsupported bounds are refused rather than treated as free.

Reservations initially cover the entire approved input-token ceiling plus capped generation and
request fees. This is deliberately conservative; actual provider-reported tokens can reduce the
reservation after a complete response. The ledger stores integer billionths of a dollar and rounds
reservations up. Provider-enforced key limits remain necessary protection against price changes,
incorrect reviewed bounds, or provider behavior; this is not a guarantee against an unrestricted
vendor bill. No positive spending allowance or new model-provider key was configured by this update.

## Knowledge Hub and physical USB

Knowledge and memories are stored in this browser's IndexedDB. That does not itself encrypt them.
Retrieved excerpts are sent to the selected model when the user starts a message or workflow.

A normal USB drive can supply a text/Markdown/CSV/JSON file through **Knowledge hub → Import file**.
The user reviews and saves it; this copies the selected content into IndexedDB. It does not mount a
live hardware-backed knowledge database or read a hardware authentication key's secret material.

[WebUSB](https://developer.chrome.com/docs/capabilities/usb) can communicate with compatible custom
USB interfaces after an HTTPS page, user gesture, device selection and permission. Standard USB
mass-storage and other protected interface classes are not generic WebUSB targets. Dedicated hardware
integration requires the device's vendor/product IDs, interface/endpoints, firmware protocol,
cryptographic design and device tests. Agent text cannot grant device permissions.

USB storage alone does **not** make the web edition air-gapped. Hosted inference and server session
sync still use the network. A hardware-only/offline mode needs a separately implemented storage
adapter, explicit sync/network controls and local inference. No WebUSB hardware adapter is shipped.

## Owner setup and live deployment

1. Enter the existing private-beta access passcode at the live app.
2. Copy `ADMIN_BOOTSTRAP_TOKEN` from Render's Environment settings, open `/admin`, and choose
   your own password of at least twelve characters. Initial password creation is atomic.
3. Remove the bootstrap variable after successful setup. Keep `SESSION_SECRET` and
   `SETTINGS_SECRET` stable across redeployments.

The current web service has no Chromium, disk or worker. `/api/browse` cannot execute without
Chromium; browser-side workflows and reviewed URL reads remain available. Postgres persists server
state and settings, but server jobs are still transient. The free database expires **November 10,
2026, 06:31 UTC**; upgrade, migrate or export before expiry. A Blueprint is a reproducible setup,
not an automatic update of an independently created service.

The remaining developer-harness milestone needs server-owned exact-action approvals, per-user
controls and provider-enforced spending/route policies, reviewed adapters, and isolated resumable
repository jobs/artifacts. Deployment and prompt roles do not establish that execution loop.

## Run and verify locally

Requires Node 22 or newer. From the repository root:

```sh
npm ci
npm run dev --workspace=packages/web
npm test --workspace=packages/web
npm run test:server --workspace=packages/web
npm run build --workspace=packages/web
npm start --workspace=packages/web
```

For a local Browser Agent, install Chromium with `npx playwright install chromium` and configure
its allowed destinations. Production API keys belong in the host's secret store; never prefix
secrets with `VITE_`. See [`packages/web/README.md`](packages/web/README.md) for connector details.

## Licenses

Apache 2.0 for this project: [`LICENSE`](LICENSE). Third-party notices are in
[`packages/web/THIRD_PARTY_NOTICES.md`](packages/web/THIRD_PARTY_NOTICES.md).
Agency Agents' pinned role files include SHA-256/source metadata and their MIT attribution.
