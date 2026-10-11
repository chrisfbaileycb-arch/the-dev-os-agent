# Signal Forge OS: deployment diagnosis and execution harness assessment

Follow-up: [Agent libraries, session-only keys, engine restrictions, and next execution milestone](agent-libraries-and-execution-next-steps.md). The follow-up supersedes the engine approval/operator-fallback findings below.

Reviewed October 10, 2026 (America/Denver). This is a source inspection and deployment HTTP assessment, not a certification of every model or integration.

Source snapshots:
- Signal Forge OS: `33c239885fc836d126a89aa87058bcdd6a0cdf23`, branch `main`.
- LobeHub fork: `7fe4f29b644fd2a18aaf527e5c09cbc091142d5b`, branch `canary`.
- Signal Forge URL identified in its Render Blueprint: https://hey-buddy-web.onrender.com.

## Why Render was green while the page failed

The live homepage answered HTTP 404 with “Not found”; `/api/providers` answered HTTP 200. In `packages/web/server/index.mjs`, the static-file response calls `cspFor(file, root)` without importing `cspFor`. The resulting ReferenceError is caught by the static handler and becomes a 404, even for files that exist. The Blueprint checks `/api/providers`, which bypasses that handler.

The repair imports the existing CSP helper. A regression test launches the actual production server against the built files and requests the homepage, admin page, JavaScript bundle, and sandbox with their expected security headers. It failed with 404 before the import and passed afterwards. The Blueprint health check now targets `/`, and CI builds before running that production HTTP test. An existing manually configured service may still need its health-check path changed in Render; editing a Blueprint does not prove the live service configuration changed.

## Agent Skills delivered with this repair

Agent Skills is now a primary navigation tab, also reachable with `/?view=skills`. It uses the same registry and editor as the Connectors drawer. It supports creating, importing SKILL.md text, inspecting, searching, editing, enabling, disabling, deleting, and exporting skills. Connector credentials are excluded from exported stacks. The current implementation stores skills in this browser and supplies enabled instructions to chat/build, browser workflows, and the managed execution engine.

This is an independent implementation built from Signal Forge's existing controls. It does not copy LobeHub source or install its marketplace packages. Importing a Markdown file does not install its dependencies, scripts, templates, or references.

## What you already have

There is substantial working infrastructure here: separate personal and operator model lanes, model discovery, streamed chat, custom agent personas, staged workflows with browser approval gates, memory and knowledge retrieval, MCP connectors, GitHub import/export, a browser compiler, and an isolated generated-app preview. There are tests for many of those boundaries. The managed Antigravity integration targets a documented Google agent API; it is a distinct execution path from the in-browser preview compiler.

The next development work should concentrate on completing and validating one end-to-end repository task. Adding more personas or model catalog entries will not solve the gaps below.

## Comparison with LobeHub

LobeHub features below are present in the inspected source. Its deployment and external integrations were not run in this assessment.

| Area | Signal Forge today | LobeHub reference | Needed for a reliable developer harness |
| --- | --- | --- | --- |
| Skills | Browser-local Markdown, global enable switches, capped prompt injection | Database-backed skills with user/workspace ownership, manifests, resource maps, ZIP/GitHub imports, and project skill resolution | Versioned packages, resource access, per-project/per-agent assignment, full frontmatter parsing, and an explicit report when instructions exceed context limits |
| Execution | In-browser build/preview plus an external managed agent adapter | A dedicated agent runtime with state managers, stream events, step locks, interrupts, and resumable human-wait states | A tracked job with a real project filesystem, shell/test runner, artifacts, logs, retries, and resume after a dropped connection |
| Persistence | IndexedDB and localStorage; optional server Postgres; live API reports ephemeral server storage | User/workspace-scoped PostgreSQL models and Redis-capable runtime state | Durable database and artifact storage, migration/backups, tenant ownership checks, and recovery across restarts/devices |
| Background work | Optional worker code; Blueprint declares no worker; queued jobs use SQLite, including an in-memory queue when Postgres is selected | Server execution state and queue coordination | A durable queue, authenticated worker, leases/checkpoints, cancellation, and idempotent external actions; current worker accepts only free-tier jobs |
| Permissions | Browser workflow gates; managed-engine approval is inferred from returned tool names | Connector permissions and explicit waiting/resume states in the runtime | Server-enforced permission decisions before a consequential tool executes, with approval tied to exact arguments and job state |
| Git lifecycle | Read connectors, generated-app push, and browser repository sync | Broader agent/project/runtime foundation; not itself proof of a complete developer IDE | Clone a pinned commit, edit on an isolated branch, inspect diffs, run actual tests, open a PR, and retain rollback/deploy evidence |
| Release validation | Unit/server tests; production HTTP coverage added in this change | Integration and product acceptance workflows | Repeatable browser checks on the deployed branch and an end-to-end task that verifies saved artifacts, Git commits, and the resulting deployment |

Source entry points: Signal Forge `src/lib/skillRegistry.ts`, `src/lib/chat.ts`, `src/lib/orchestrator.ts`, `src/ui/OutputPanel.tsx`, and `server/{index,jobs,worker,state,antigravity}.mjs` under `packages/web`; LobeHub `packages/database/src/schemas/agentSkill.ts`, `apps/server/src/services/skill/`, `apps/server/src/modules/AgentRuntime/`, `src/features/Settings/skill/`, and `apps/server/src/routers/lambda/agentSkills.ts`.

## Priorities before a public paid launch

1. **Enforce access and approvals on the server.** The beta gate is a client-side curtain and can be bypassed by a localStorage flag. The current Vite config also uses the published development passcode when a production build has no configured beta key, contrary to its comments. `createEngine` can use the operator's `ANTIGRAVITY_API_KEY` without an account/plan check, an origin check, a rate limiter, or a usage ledger. Do not enable an operator-funded execution engine publicly until those checks exist. First-run admin setup should require an operator bootstrap credential before a visitor can claim it.
2. **Move managed-engine approvals ahead of tool execution.** `runAntigravity` reads the upstream stream into an events array, then scans it for tool names needing approval. At that point a returned tool result may describe an action already completed upstream. The UI's held state cannot establish that the action was prevented. Use supported pre-execution interception or an application-controlled tool dispatcher, and test a denied action by proving that the external call did not occur.
3. **Make work survive restarts.** The live API reports `storage.kind: ephemeral` and `ledger: browser`. Connect a durable database for workspace/settings/ledger data. Persist jobs and artifacts separately; selecting Postgres currently creates `jobsSqlite` in memory, so it does not make the job queue durable. OAuth scaffolding exists, but state routes still use a browser-supplied workspace UUID as their handle; account ownership needs to govern reads and writes for a multi-user product.
4. **Prove the complete developer loop.** Start with one repository and one concrete bug: import its commit, change files, execute the repository's own test command, retain exit code and logs, review the diff, push a branch, and verify the deployed behavior. Generated code and a successful browser bundle demonstrate less than successful backend tests. Keep Google sandbox jobs, browser preview builds, and browser automation labeled by what actually ran.
5. **Upgrade skills as packages and operations as evidence.** Add skill versions, source/license metadata, resource files, assignment, dependency checks, and export/import round trips. Show which instructions were included or clipped, which tool calls ran, what they cost, and what artifacts were produced. Browser-only storage and silent prompt truncation will become reliability problems as the library grows.

## Deployment configuration still to confirm

The existing account's Render connector returned one workspace, “Christopher's workspace,” but requires the user to confirm that workspace before resource/log/configuration operations. No paid resource was provisioned during this inspection.

For the current Node service, use a root-directory build from the repository (`npm ci && npm run build`), a start command of `node packages/web/server/index.mjs`, Node 22 or newer, and health check `/`. Set an operator-controlled `ADMIN_TOKEN` and beta passcode through secure settings. Connect a durable database and confirm its backup/retention plan. The current live API reports both managed free and paid pools disabled, so an accessible page does not establish an operator-funded model or subscription is ready. Bring-your-own-key operation remains a separate path.

Chromium browser automation requires an appropriate Docker/runtime installation; the existing Blueprint explicitly omits it. A background worker is a separate deployment decision and also needs a durable queue. Provider credentials, OAuth credentials, billing checkout configuration, and any paid hosting choices require the owner's actual accounts and appropriate secret entry; none can be inferred from a public repository.

## A credible product position

The broad claim that nobody in America has a browser-based AI developer environment is not supportable. Replit Agent already covers AI-assisted application building, and Google documents a browser development environment in Firebase Studio (its current page says new signup/workspace creation is no longer supported). Signal Forge can earn a specific position through transparent model choice, visible permissions, reusable skills, and verifiable completion for a defined customer workflow. Those are product hypotheses until customers and end-to-end tests validate them.

Primary references checked during this assessment:
- [Google Antigravity agent API](https://ai.google.dev/gemini-api/docs/antigravity-agent)
- [Replit Agent](https://docs.replit.com/features/agent/overview)
- [Firebase Studio](https://firebase.google.com/docs/studio)
- [Your LobeHub fork](https://github.com/chrisfbaileycb-arch/lobehub)

LobeHub's repository LICENSE adds a commercial licensing condition for developing and distributing derivative works. This comparison uses its architecture as a reference. Any future proposal to copy its source should be reviewed against that license before implementation.

## Validation record

The production build passed. All 313 browser/unit tests passed; the server suite reported 192 passing tests, zero failures, and three skips (browser-runtime/live-upstream cases). The new HTTP regression failed before the import and passed after it. A full local browser smoke attempt was blocked by the unavailable Chromium executable and a failed official Playwright browser download; the cloud browser could not reach this container's localhost. Visual and paid-provider execution validation must therefore be reported separately from the passing DOM and HTTP tests.
