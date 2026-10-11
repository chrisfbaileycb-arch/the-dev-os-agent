# Signal Forge OS: agent libraries and the next execution milestone

Reviewed October 10, 2026, America/Denver. This follow-up updates the earlier [harness assessment](signal-forge-harness-assessment.md). Render is the current test host, not a selected launch platform. No paid resources, provider keys, admin passwords, checkout links, or public launch settings were configured in this follow-up.

## What the repositories actually contain

| Repository snapshot | Finding | Useful contribution to Signal Forge |
| --- | --- | --- |
| [Agency Agents](https://github.com/chrisfbaileycb-arch/agency-agents/tree/f99f6aa910a442b0197b768ce0ea7751e35e2060), `main` | 267 frontmatter Markdown role definitions across 18 divisions. They include identity, responsibilities, rules, workflow steps, deliverables, examples, and success criteria. Shell/Python tooling converts and installs these definitions for different agent hosts. | Detailed, reusable role and workflow content. The host must supply the actual tools, filesystem, persistence, approval enforcement, and tests. |
| [LobeHub](https://github.com/chrisfbaileycb-arch/lobehub/tree/7fe4f29b644fd2a18aaf527e5c09cbc091142d5b), `canary` | Skill instructions use Markdown/SKILL.md. Source also defines manifests, resource maps, ZIP/GitHub imports, versions, database ownership, workspace associations, and activation/resource tools. Agent instructions are a separate runtime configuration. | A reference architecture for packaging and activating instructions alongside resources and permitted tools. The Markdown is one part of a larger execution system. |
| Signal Forge, reviewed from `f8821f2171d716df19e18bfc2bc0620e5e37d949` plus this repair | Agent Skills supports custom Markdown, search/edit/import/export, enable switches, and separate live connectors. Skills are browser-local; enabled text is injected into prompts. | A useful starting UI that needs package provenance, complete activation, resource access, agent/project assignment, and execution evidence. |

The Agency Agents link was supplied twice; it identifies one repository, not two separate libraries. No screenshots were received for this assessment. Findings come from the source snapshots above.

Agency Agents' MIT license permits reuse subject to retaining its copyright and license notice. Its LICENSE attributes AgentLand Contributors, 2025. LobeHub has additional community/commercial license terms; this work does not copy its implementation. Inspect the actual license before distributing a derivative. Source instructions such as “persistent memory” describe a desired agent behavior; they do not create a working memory service.

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
| 5 | Complete one repository repair in an isolated workspace, with durable jobs/artifacts and reviewable Git output. | Pinned input commit → scoped diff → repository test logs and exit code → review → branch/PR. A disconnect and worker restart can resume without repeating an external write. |

For the next visit, the concrete milestone should be one small repository bug fixed through that complete loop, using two or three selected roles. Decide the final host after specifying the sandbox, queue, database, artifact storage, geographic processing, and budget requirements. Those are deployment-independent requirements.

## Commit history and the reported deployment explanation

The recent history contains repeated removals, repeated reverts, and routing changes, consistent with the workflow confusion described. This review did not reconstruct every historical deployment or inspect the Render build environment, and it cannot attribute another repository being inserted to a particular assistant. The confirmed homepage failure was the missing cspFor import; the earlier repair restored HTTP 200. Future releases should record one repository, branch, commit SHA, build output, and test result, and use checks before updating the deploy branch. No older commit was restored and history was not rewritten.

## Validation

The production build and 315 frontend tests passed. The server suite passed 193 tests with zero failures and three explicit skips for unavailable Chromium/live upstream checks. Regression coverage proves that blocked managed connectors make no upstream request, no operator engine key is used as fallback, known legacy credentials are removed, and every tested personal-key storage slot is empty after a page/module reload. The production HTTP regression also passed. Browser interaction and paid-provider budget enforcement are separate future acceptance tests.
