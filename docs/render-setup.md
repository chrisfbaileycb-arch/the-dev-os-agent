# Signal Forge Render test deployment

Source: `chrisfbaileycb-arch/the-dev-os-agent`, branch `main`.
App: https://hey-buddy-web.onrender.com
Render service: `srv-dahrsjad0e5s738lvfsg`, Christopher's workspace, Oregon.

The existing service builds with `cd web && npm ci && npm run build` and starts with
`cd web && npm start`. `web/package.json` is a compatibility bridge to `packages/web`;
there is one current app, not a separate older deployment. A push to `main` triggers deployment.
`render.yaml` describes a reproducible test topology; it is not automatically applied to an
existing service unless the service is managed through a Blueprint.

## Initial owner setup

1. Open Render > hey-buddy-web > Environment. Copy `ADMIN_BOOTSTRAP_TOKEN` using the
   dashboard's secret control. Do not put it in source code, a skill, a URL, or an issue.
2. Open https://hey-buddy-web.onrender.com/admin, enter the setup code, and choose your own
   password of at least 12 characters. Keep the password in your password manager.
3. After successful setup, remove the bootstrap variable from Render. The stored password is
   a scrypt hash; simultaneous setup attempts cannot replace the first password.

Without a configured bootstrap code or an existing `ADMIN_TOKEN`, admin setup is locked.
An existing environment `ADMIN_TOKEN` overrides a database password; direct-token operators
manage that token in Render. `SETTINGS_SECRET` seals operator settings outside the database.
Keep it stable across redeployments. Personal visitor keys stay in page memory and clear on reload.

## Workspace ownership

`SESSION_SECRET` must be a random value of at least 32 characters. `/api/workspace/session`
issues a signed, HttpOnly, SameSite=Strict cookie for an anonymous workspace. Google OAuth,
when separately configured, supplies the account's canonical workspace. Server state and
browser job requests require this proof; a UUID alone cannot read, replace, or delete data.
A mismatching workspace header is refused. Keep `WORKSPACE_AUTH_REQUIRED=true` on hosted apps.
Local IndexedDB data remains in the browser and is reconciled into the new owned workspace;
old server-only data is not claimed by accepting an unverified browser UUID.

`APP_ORIGIN=https://hey-buddy-web.onrender.com` pins write requests to this deployment.
Google sign-in additionally needs Google-issued client credentials and a registered callback;
it is optional and is not implied by anonymous workspace identity.

## Funding stays disabled

`OPERATOR_FUNDING_DISABLED=true` stops keyless and plan-funded provider requests before
upstream discovery or inference dispatch. The switch is controlled by Render, not an imported
prompt or a dashboard tunable. `FREE_TIER_DISABLED=true` and `FREE_CREDIT_MONTHLY_POOL=0`
are also set. Personal provider keys still work and their providers bill their owners.

`DAILY_SERVER_BUDGET_USD=0` and `MANAGED_MODEL_COST_BOUNDS_JSON=[]` also fail closed.
The proxy now reserves a reviewed maximum cost in the shared database before every funded
attempt, including each retry. Reservations survive restarts, concurrent requests and workspace
clearing. Missing usage, failed calls and interrupted streams retain the reservation; complete
valid usage settles it once. UTC midnight starts a new day. Unknown prices, nontext inputs and
ephemeral storage cannot receive funding. See the root README for the cost-bound schema.

Keep funding disabled until you choose a daily allowance and verify full context/output cost
bounds, reasoning and cache treatment, fees, provider key limits, and supported adapters.
The dollar reservation ledger does not replace per-user controls or provider-side limits.
No positive spending allowance or checkout links were supplied in this deployment work.

Experiment chat and model discovery require a personal provider key before upstream routing.
The browser sends `X-Forge-Is-Experimental: true`; the proxy also checks provider classification
and experimental metadata, so removing the header cannot enable operator funding.
Five-stage workflows permit three calls per stage, fifteen client requests total. Tool chat
permits three model requests and two tools. The server independently limits retries to three
upstream attempts, reserving each funded attempt.

## Database and limitations

`signal-forge-test-db`, Postgres 16, Oregon, ID `dpg-db5iqebbc2fs73922ocg-a`, is the
free test database created for this deployment. Connect its **internal** URL to `DATABASE_URL`
on the web service; do not use the external connection or expose credentials to the client.
The database restricts external IP access and the app uses a pool of five connections.

The database expires **2026-11-10 06:31 UTC** (**November 9, 2026, 11:31 PM Denver**).
Render's free plan has no backups and is a 30-day test resource. Upgrade, migrate, or export
before expiry; restarting the web app is not the same as making a backup. This deployment
must not be represented as a production data-retention guarantee.

The existing web service's instance plan was retained. Chromium, a queue worker, an isolated
repository execution sandbox, and resumable jobs/artifacts are not provisioned. Browser-side
workflows remain available. Server jobs with a Postgres workspace store are still transient.

## Skills

Code Reviewer, Git Workflow Master, and SRE are shipped as complete, initially disabled
Agency Agents roles pinned to `f99f6aa910a442b0197b768ce0ea7751e35e2060`, with SHA-256,
source, author, and MIT license metadata. The license is also served under `/licenses/`.
Select only the roles needed for the task in Agent Skills. Markdown and JSON stack imports
preserve complete instruction bodies and bundled text resources; imported connectors do not
receive permissions. Editing a personal imported body creates a local skill without claiming
its old source hash.

Selected instructions have a 64,000-character activation budget. If exceeded, the UI blocks
the next run and explains how to reduce selection. It does not silently clip workflows.
This character budget does not guarantee that every selected model has sufficient context.
Imported resources remain text packages; external scripts/dependencies are not installed.

## Release verification

Check `/api/health` for `ok`, deployed commit, storage kind, identity configuration,
funding-disabled status and `dailyServerBudgetUsd: 0`. Also check `/` and `/admin` return HTML successfully. Test anonymous
admin setup rejection, forged/mismatched workspace denial, and funding rejection before
claiming the app is ready. Record the exact commit and tests with each release.

The remaining execution milestone is a real repository repair in an isolated environment:
pinned input commit -> scoped diff -> repository test logs/exit code -> review -> branch/PR.
It requires the server-owned exact-action approval dispatcher, per-user controls before owner funding,
reviewed adapters, and durable resumable jobs/artifacts. This deployment completes the initial
host/security foundation and skill preservation; it does not claim that whole loop is finished.
