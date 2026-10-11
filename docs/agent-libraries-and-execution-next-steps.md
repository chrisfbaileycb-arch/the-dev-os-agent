# Signal Forge OS: agent libraries, public API access, and the next execution milestone

Reviewed October 11, 2026 UTC (October 10, America/Denver), including the three supplied LobeHub screenshots. This follow-up updates the earlier [harness assessment](signal-forge-harness-assessment.md). Render is the current test host, not a selected launch platform. No paid resources, provider keys, admin passwords, checkout links, or public launch settings were configured in this follow-up.

## What the repositories actually contain

| Repository snapshot | Finding | Useful contribution to Signal Forge |
| --- | --- | --- |
| [Agency Agents](https://github.com/chrisfbaileycb-arch/agency-agents/tree/f99f6aa910a442b0197b768ce0ea7751e35e2060), `main` | 267 frontmatter Markdown role definitions across 18 divisions. They include identity, responsibilities, rules, workflow steps, deliverables, examples, and success criteria. Shell/Python tooling converts and installs these definitions for different agent hosts. | Detailed, reusable role and workflow content. The host must supply the actual tools, filesystem, persistence, approval enforcement, and tests. |
| [LobeHub](https://github.com/chrisfbaileycb-arch/lobehub/tree/7fe4f29b644fd2a18aaf527e5c09cbc091142d5b), `canary` | Skill instructions use Markdown/SKILL.md. Source also defines manifests, resource maps, ZIP/GitHub imports, versions, database ownership, workspace associations, and activation/resource tools. Agent instructions are a separate runtime configuration. | A reference architecture for packaging and activating instructions alongside resources and permitted tools. The Markdown is one part of a larger execution system. |
| [Public APIs](https://github.com/chrisfbaileycb-arch/public-apis/tree/8d76e631bdd420316f14f839b3de4c6f9028be7f), `master` | A Markdown directory of REST APIs and a separately shaped MCP-server table. It records auth, HTTPS, and CORS claims; it does not implement those services or guarantee current availability or unrestricted use. | A pinned, searchable discovery catalog. Signal Forge now imports 2,043 distinct REST entries across 51 categories, plus a separately reviewed NASA Images endpoint. |
| [Agent-Reach](https://github.com/chrisfbaileycb-arch/Agent-Reach/tree/94f06c1969dfc1834001269d79d3ad0972d9dee6), `main`, version 1.5.0 | Python CLI and channel adapters/diagnostics for upstream readers and tools. Some public reads are keyless; other routes need installed programs, login cookies, tokens, model keys, or proxies. | Implementation ideas for selected read adapters and capability diagnostics. It is not a frontend component or a uniformly keyless MCP server. |
| Signal Forge, reviewed from `082026022a97ce9c6675d6b9d0ad3f2363e11231` plus this addition | Agent Skills supports custom Markdown, search/edit/import/export, enable switches, and separate live connectors. Skills are browser-local; enabled text is injected into prompts. The new API directory supplies discovery, explicit example reads, and workspace drafts. | A useful starting UI that needs package provenance, complete activation, resource access, agent/project assignment, and execution evidence. |

The Agency Agents link was supplied twice; it identifies one repository, not two separate libraries. Source snapshots and screenshots support different conclusions: code reveals the host architecture, while the screenshots show particular catalog entries and instruction text. Neither establishes that every advertised capability runs successfully in the hosted product.

Agency Agents' MIT license permits reuse subject to retaining its copyright and license notice. Its LICENSE attributes AgentLand Contributors, 2025. LobeHub has additional community/commercial license terms; this work does not copy its implementation. Inspect the actual license before distributing a derivative. Source instructions such as “persistent memory” describe a desired agent behavior; they do not create a working memory service.

Public APIs' MIT notice (copyright 2022 public-apis) is preserved in `packages/web/public/licenses/public-apis-MIT.txt` and included in the built site. This license covers the directory metadata, not each provider's API service, datasets, or media. Agent-Reach's MIT notice credits Agent Eyes, 2025; no Agent-Reach code has been installed or copied into the runtime.

## What the screenshots confirm about agents and skills

| Screenshot | Visible evidence | Runtime requirement |
| --- | --- | --- |
| PowerPoint skill | Markdown instructions referencing pptxgenjs, Python scripts, validation, and LibreOffice tooling. | A package containing the referenced resources, installed dependencies, filesystem access, and an execution environment. Viewing the Markdown alone cannot create or edit a presentation. |
| Self Improvement skill | Markdown directing the agent to write `.learnings/ERRORS.md`, `LEARNINGS.md`, and related files, then promote useful instructions to project guidance. | Authorized file writes, durable project storage, and a review process. This is instruction/log maintenance, not automatic training of model weights. |
| Jailbreak Mode agent profile | A system-prompt profile asks the model to disregard constraints; the page also exposes an Agent Capabilities tab and a cybersecurity tag. | A prompt does not itself grant network, shell, filesystem, or credential access, nor prove that a model will bypass safeguards. This particular profile is unsuitable for Signal Forge's curated library. |

The agent card's title and synopsis are presentation metadata. In the LobeHub source, agents have separate system-role, model/provider, parameter, and plugin fields. The Agent Profile renders the system role; Agent Capabilities renders configured plugins. Its skill manifests and ZIP parser support resources, provenance/version metadata, and hashes in addition to SKILL.md. Therefore, the assessment is **Markdown instructions backed by a larger host**, with capabilities dependent on configuration, tools, permissions, and environment—not merely empty cards and not automatically executable Markdown.

Source evidence:
- [Agent schema](https://github.com/chrisfbaileycb-arch/lobehub/blob/7fe4f29b644fd2a18aaf527e5c09cbc091142d5b/packages/database/src/schemas/agent.ts)
- [Skill types and manifests](https://github.com/chrisfbaileycb-arch/lobehub/blob/7fe4f29b644fd2a18aaf527e5c09cbc091142d5b/packages/types/src/skill/index.ts)
- [Skill package parser](https://github.com/chrisfbaileycb-arch/lobehub/blob/7fe4f29b644fd2a18aaf527e5c09cbc091142d5b/apps/server/src/services/skill/parser.ts)

Cybersecurity agents can support legitimate defensive work: reviewing owned code, checking dependencies, examining supplied logs, and testing systems with permission. A catalog tag is not the security boundary. For Signal Forge, curate defensive roles, exclude instruction-bypass profiles, require authorized targets, and enforce tool permissions on the server. Imported prompts and remote content must never grant themselves access or change policy. Future write/network approvals must bind to the actual action before it executes. Denial must result in zero calls. A US-focused model catalog is a separate jurisdiction policy and does not replace these controls.

## API directory implemented in this addition

The primary navigation now includes **API directory**, also reachable with `/?view=apis`. It provides search, category filters, access types, HTTPS filtering, reviewed-only filtering, and pagination. The default shows source-listed no-key entries over HTTPS. Source-only entries are explicitly marked as needing provider review; their HTTPS/CORS/auth fields are directory claims, not live measurements. 971 imported entries list “No” auth; that does not prove all 971 still work without signup. NASA Images adds one reviewed no-key endpoint.

Six examples were reviewed against provider documentation and the exact public GET URLs returned HTTP 200 with no key/login on October 11 UTC:

| Example | Access and limitations | Official reference |
| --- | --- | --- |
| National Weather Service | No key at review time; application User-Agent and reasonable rate limits required; a key may be introduced later. | [Services API](https://www.weather.gov/documentation/services-web-api) |
| USGS earthquakes | Public read query with bounded results; follow service limits. | [FDSN event API](https://earthquake.usgs.gov/fdsnws/event/1/) |
| NHTSA vPIC | Public vehicle make/type catalog read; no personal VIN in the example. | [vPIC API](https://vpic.nhtsa.dot.gov/api/) |
| NASA Images | Keyless image metadata search at images-api.nasa.gov; other NASA APIs may need keys. Media credits and reuse conditions still apply. | [Images API documentation](https://images.nasa.gov/docs/images.nasa.gov_api_docs.pdf) |
| Open-Meteo | Free keyless endpoint for non-commercial use within published limits; commercial use needs a paid plan/key and attribution applies. | [Pricing and terms](https://open-meteo.com/en/pricing) |
| Open Library | Human-directed book discovery, default one request/second; not a bulk harvesting or high-traffic commercial backend. Frequent use needs application/contact identification. | [Usage guidelines](https://openlibrary.org/developers/api) |

**Read example** makes one user-initiated GET through the existing `/api/fetch` reader. It does not forward provider credentials/cookies, run page scripts, follow returned links, install MCP servers, or grant agent permissions. The reader retains its DNS/address and redirect checks, origin checks, response limits, optional host allowlist, and rate limit. It now accepts structured JSON media types such as NWS's `application/geo+json` while rejecting binary and JavaScript media types. The network call and returned text are bounded; text is displayed safely and may be truncated.

**Use in workspace** puts the reviewed endpoint and usage conditions in the message box. The user must send it; no run is started by that button. It respects the existing agent URL-reader toggle. This is a draft using the existing `fetch_url` tool, not an installed provider-specific connector or an exact-action permission guarantee. Account/key services are listed for discovery but require a separate connector implementation and session-only credential design before execution. No shared “free API keys” are supplied.

The directory is loaded in a separate frontend chunk and browsing/filtering makes no provider requests. `scripts/import-public-apis.py` regenerates the pinned snapshot from a clean checkout and retains the MIT notice. It excludes the 13 MCP table entries because transport/install metadata is a different schema. One malformed REST row, MapQuest at source line 1328, is excluded and recorded in `skippedLines`; duplicate name/URL pairs merge categories. Refreshes need review rather than automatic tool enablement.

## Agent-Reach: useful adapters, incompatible credential defaults

Agent-Reach is more than a set of role prompts: it includes channel classes, public URL handling, backend selection, setup tooling, and diagnostics. Public web reads use Jina Reader; other channels depend on tools such as yt-dlp, mcporter, and OpenCLI. The Node app would need an isolated Python/tool worker or separately adapted interfaces to use those capabilities. A README promise of “zero API fees” is not a guarantee that every platform needs no login or every dependency is cost-free.

Its Config writes settings and credentials to `~/.agent-reach/config.yaml`. It uses owner-only atomic writes and symlink checks, which are useful protections, but persistent disk storage conflicts with the requirement that personal credentials expire with the browser session. Some social routes need exported cookies or an existing signed-in Chrome session; others need optional transcription/model keys or proxies. This work did not install Agent-Reach, extract cookies, read browser sessions, or attach it to the shared host.

Capability checks also differ in strength: the web channel declares Jina available without a network probe; the Exa channel explicitly warns that a configured MCP server is not verified reachable. Signal Forge should preserve that distinction in all capability status: **listed → configured → tested → permitted**.

Recommended incorporation: begin with public URL and RSS reading in isolated, read-only adapters. For each adapter, record source version, dependencies, data destination, rate/usage terms, and exact allowed operations. Add tenant-scoped ephemeral credentials only where needed; no browser-cookie harvesting, global login profile, or shared home directory. Require operator-reviewed MCP tools and explicit permissions before adding writes. The current API directory does not install or invoke Agent-Reach.

Primary implementation references: [Config persistence](https://github.com/chrisfbaileycb-arch/Agent-Reach/blob/94f06c1969dfc1834001269d79d3ad0972d9dee6/agent_reach/config.py), [web channel](https://github.com/chrisfbaileycb-arch/Agent-Reach/blob/94f06c1969dfc1834001269d79d3ad0972d9dee6/agent_reach/channels/web.py), [Exa diagnostic](https://github.com/chrisfbaileycb-arch/Agent-Reach/blob/94f06c1969dfc1834001269d79d3ad0972d9dee6/agent_reach/channels/exa_search.py).

For a developer harness, start by evaluating Code Reviewer, Git Workflow Master, SRE, Software Architect, Frontend Developer, Backend Architect, and Privacy Engineer. Review stack-specific requirements before inclusion: for example, the Senior Developer role assumes Laravel/Livewire/FluxUI, which does not match Signal Forge's React/Node stack. Some referenced paths presume files in a host project that this repository does not supply.

## Why a bulk import is premature

Signal Forge currently keeps at most 24 custom skills, clips saved/imported instruction bodies to 12,000 characters, includes at most 4,000 characters per activated skill, and caps the combined instruction text at 8,000 characters. In the Agency snapshot, 159 source files exceed 12,000 characters and 254 exceed 4,000 characters (counts include frontmatter). Cutting them at those limits can remove workflows, review criteria, and examples. Renaming a role file SKILL.md would not install its capabilities.

The next implementation should retain complete original content, pin the source commit and hash, preserve license/author metadata, and show the activation budget. Load only the skill needed for the current step, with explicit resource access. If a complete workflow cannot fit, stop or ask for a smaller selection instead of silently truncating it. Do not enable the entire catalog globally or grant connector permission based on instructions in an imported file.

## Repairs completed in this follow-up

- Personal model keys, optional local-server keys, the managed-engine key, GitHub sync and connector tokens, MCP tokens, skill connector tokens, and plan access tokens are now held in page memory rather than persistent browser storage. Reloading or closing the page clears them. Non-secret model, repository, and UI preferences can still persist.
- Startup removes known legacy saved credentials without restoring them. “Remember” checkboxes were removed. The Settings clear action also clears connector and engine credentials in the page.
- Localhost support for LM Studio/Ollama remains an explicit opt-in. Local model requests go directly from the browser to allowed loopback addresses; they do not use the hosted proxy.
- The managed engine refuses enabled external connectors before uploading any credentials or starting any upstream run. It rejects a client-supplied text approval as authorization. It sends only code-execution tools with sandbox network access disabled, including when reusing an environment. Completed upstream tool events are not presented as pending approvals.
- The engine requires the visitor's explicit session key. It no longer falls back to an operator ANTIGRAVITY_API_KEY. Legacy engine approval cards cannot restart a run with external access.
- The UI explains session lifetime, transmission to providers, provider billing, and the need for provider-side limits. Clearing a key does not revoke it or cancel a request already accepted upstream. Tokens and prompts should never contain credentials for downstream services.

This is a conservative offline mode, not the finished per-action approval dispatcher. Network-dependent package installation and managed connector operations cannot run in this mode. Chat/browser connector paths are separate from the managed engine and still need their own permission review before a multi-user release. No paid Google engine call was made to validate this policy live; tests verify the outgoing request and prove zero fetches for denied connector/approval cases.

## OpenRouter as the managed source of truth

This is a reasonable direction, but it requires changing the current backend. Its funded-provider registry currently limits operator funding to direct OpenAI, Anthropic, Google, Groq, and xAI routes; it does not make OpenRouter an operator-funded paid route. The OpenRouter experiment slot is personal-key access and is not an owner-funded gateway. Do not paste the operator's key into that browser field.

Recommended design:

1. Keep the operator completion key server-side in the chosen host's secret store, separate from visitor session keys. Use a dedicated limited key for the test environment; never use an unrestricted management key for inference.
2. Set a provider-enforced USD key cap and, where available, model/provider guardrails. Use prepaid test credits with automatic top-up disabled. Select lifetime versus daily/monthly resets deliberately; resetting a limit authorizes a new allowance.
3. Add an atomic server budget ledger with reservations before dispatch, actual-cost reconciliation, per-user quotas, a global cap, concurrency limits, maximum run duration/steps/tokens, and an emergency disable switch. Refuse work when the ledger or price information is unavailable. Treat retries and parallel runs as spending too.
4. Maintain explicit approved model IDs and serving-provider routes. New models start disabled; the operator reviews cost, capability, ownership, license, and hosting before enabling them. Apply policy on the server and at the provider; hiding a model in the picker is insufficient. Never fall back to an unapproved model or provider.
5. Keep model developer nationality, serving-provider ownership, and physical processing region as separate fields. A US company can serve non-US-developed weights or process requests outside the US. Decide which of those policies the product promises, then enforce and verify it per route. Do not label a route US-only based only on its display name.

OpenRouter documents key spending limits, disable controls, and model/provider guardrails. It also states that presets can be overridden by request parameters, so presets alone do not establish an unbypassable restriction. These controls still need to be configured and tested on the owner's account. The current app's token/credit counters are not a verified dollar cutoff; no such guarantee is made by this repair.

Primary references checked October 11, 2026 UTC:
- [OpenRouter key creation and USD limits](https://openrouter.ai/docs/api/api-reference/api-keys/create-keys)
- [OpenRouter spending controls and guardrails](https://openrouter.ai/blog/tutorials/team-spend-controls-setup/)
- [OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)
- [Google managed-agent environments and network controls](https://ai.google.dev/gemini-api/docs/agent-environment)
- [Google pre/post execution hooks](https://ai.google.dev/gemini-api/docs/agent-hooks)

## What remains before meaningful execution testing

| Priority | Next work | Acceptance evidence |
| --- | --- | --- |
| 1 | Protect initial admin setup with an operator bootstrap credential; configure server-side identity and workspace ownership. Keep funded plans disabled until budget controls are ready. | Anonymous visitors cannot claim admin, read another workspace, or spend the operator key. |
| 2 | Install a small curated skill set with full bodies, source SHA/hash, MIT attribution, resource support, and per-task selection. | Import/export preserves the complete workflow; activation identifies exactly what was loaded and never silently clips it. |
| 3 | Implement the server-owned approval dispatcher. Bind approvals to user, job, tool, exact arguments, and expiry; consume them once. | Denial causes zero external calls; edited arguments and replayed approvals fail; approval permits exactly one matching action. |
| 4 | Implement OpenRouter funding and dollar budgets with an approved model/provider catalog. | Over-budget, unapproved-model, retry, and simultaneous-request tests fail before dispatch; provider-side rejection also stops work. |
| 5 | Turn a few reviewed APIs and selected Agent-Reach ideas into scoped read adapters; review MCP transport, permissions, and credential lifetime separately. | Read-only operations, allowed destinations, rate/term handling, untrusted-result handling, and no credential persistence are tested. “Configured” is never shown as “tested.” |
| 6 | Complete one repository repair in an isolated workspace, with durable jobs/artifacts and reviewable Git output. | Pinned input commit → scoped diff → repository test logs and exit code → review → branch/PR. A disconnect and worker restart can resume without repeating an external write. |

For the next visit, the concrete milestone should be one small repository bug fixed through that complete loop, using two or three selected roles. Decide the final host after specifying the sandbox, queue, database, artifact storage, geographic processing, and budget requirements. Those are deployment-independent requirements.

The strongest product opportunity is a browser developer harness that proves what it executed: complete and attributed skill packages, controlled tool access, enforced budgets, isolated jobs, and reproducible Git changes. More role cards or more directory entries alone do not establish that quality. This technical review does not establish market exclusivity in America; any uniqueness claim needs a separate competitor study and measurable product evidence.

## Commit history and the reported deployment explanation

The recent history contains repeated removals, repeated reverts, and routing changes, consistent with the workflow confusion described. This review did not reconstruct every historical deployment or inspect the Render build environment, and it cannot attribute another repository being inserted to a particular assistant. The confirmed homepage failure was the missing cspFor import; the earlier repair restored HTTP 200. Future releases should record one repository, branch, commit SHA, build output, and test result, and use checks before updating the deploy branch. No older commit was restored and history was not rewritten.

## Validation

The earlier session-key/engine repair passed its production build, 315 frontend tests, and 193 server tests with three explicit skips. Those tests covered blocked managed connectors, operator-key fallback, legacy credential removal, and empty personal-key storage after reload.

For this API addition, the production build and all 324 frontend tests passed. Coverage checks access classification, safe directory URLs, REST/MCP separation, filters/pagination, no provider requests on directory mount, draft-only workspace actions, the existing URL-reader toggle, explicit example reads, cancellation, and text-safe output. Eleven focused server/production HTTP checks also passed, including structured JSON acceptance, binary rejection, private/credentialed target refusal, redirect validation, allowlists, and limits.

Automatic approval review initially blocked the full server suite because an existing discovery test unexpectedly started real OpenRouter metadata discovery. That test now explicitly stubs OpenRouter discovery alongside its gateway fixture. The full suite then passed 194 tests with zero failures and three explicit skips for unavailable Chromium/live-upstream checks, using an environment without inherited provider credentials. These tests do not validate paid-provider budget enforcement or a complete live developer execution loop.
