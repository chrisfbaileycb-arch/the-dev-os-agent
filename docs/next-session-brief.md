# Next session brief: Signal Forge OS

Written 2026-10-09. This replaces the Hey Buddy / Floot brief. Do not rename the product backward. The README is the source of truth for what is shipped; this file is the plan that produced the current cut.

Product: Signal Forge, a privacy-first progressive web app for one person or a small business on a Chromebook or any modern browser. One rail, one dock. No second slide-out. No desktop app, no mobile store app, no "download the app" modal. Install is the browser's own prompt: a quiet chip when `beforeinstallprompt` fires, plus the Settings install button.

Brand line: "Your AI crew. Always in your corner."

The app is [`packages/web/`](../packages/web/) (Vite, React 19, Node 22). Root `web/` is only a Render bridge. Do not edit application code there. Live host: https://hey-buddy-web.onrender.com (Render service `hey-buddy-web`, branch `main`).

## Ground rules

- Original code and original prompts only.
- Do not copy LobeHub / Lobe Chat (community license). Ideas only. Do not adopt `lobe-ui`.
- Do not copy Cherry Studio (AGPL).
- Do not import or wrap Hermes Agent. Do not shell out to the `agy` CLI. Do not implement Nous Research OAuth plugins.
- Do not edit `github.com/chrisfbaileycb-arch/carol-ann-trib-3-1`. It is a reference, not a merge target. Carol Ann is credited as the owner's own reference for the skills registry, not as an upstream.
- Do not put OpenRouter or Hugging Face on the free tier or in Shield.
- Do not add accounts, payments, or a plugin market of thousands.
- Emoji are banned. Lucide icons only.
- Apache 2.0 on the repo. MIT notice for the Ruflo subset in `packages/web`. Credit FreeToken, Ruflo, AnythingLLM, LobeHub, and Cherry Studio as inspiration.

## Lanes

Already decided in `packages/web/server/providerRegistry.mjs`.

- **Shield.** US company, own API or US host: anthropic, openai, google, xai, groq, cerebras, github, nvidia, meta. The funded free tier is an allowlist inside that, metered. Relays are never Shield.
- **Local.** Ollama / LM Studio / a URL the visitor typed. Nothing leaves the machine. A public HTTPS page cannot quietly call `127.0.0.1`. Ship a Test button that requests local-network access and shows the exact `OLLAMA_ORIGINS` value. If the browser refuses, say so. Do not pretend a native app is required.
- **Experiment.** OpenRouter and Hugging Face only. Own key slots. Third group in the model menu. Subtitle: "Your key. May route outside the US. Not the free tier." Hugging Face means the Inference Providers router (`router.huggingface.co`, OpenAI-compatible), not the retired free inference API. Pin-from-catalog inside the picker. No new chrome.

## Antigravity (an engine, not a model)

Google's managed agent, not Gemini chat. Pinned 2026-10-09 from https://ai.google.dev/gemini-api/docs/antigravity-agent:

- Agent id `antigravity-preview-09-2026`.
- `POST https://generativelanguage.googleapis.com/v1beta/interactions`
- Header `x-goog-api-key`. On the wire this is a Gemini API key. In the product it is a different slot. Never reuse the Gemini chat key unless the operator pastes it into this slot.
- `environment: "remote"` provisions a Linux sandbox Google hosts. Reuse `environment_id` across turns. Files go in and out with the sandbox. MCP secrets go through the Credentials API (`POST /v1beta/credentials`) so the model never sees the token.
- Default tools: `code_execution`, `google_search`, `url_context`, filesystem when environment is set. Custom tools: `function`, `mcp_server`.
- Cap every run with `agent_config.max_total_tokens`. Default model `gemini-3.8-flash`. Do not send temperature or other unsupported generation params.
- UI: "Run with the execution engine" on a workflow step or a long task. Not a row in the chat model picker. Stream the plan and the tool trace into the existing run card. Signal Forge keeps approval of anything that spends money, sends a message, or leaves the sandbox.
- Shield-eligible because Google hosts it in the US, but it is an engine, not a funded chat model. Off until the key is saved. Not on the free tier.

## Skills

The connector habit, nothing else, from Lobe: a skill or MCP server is listed, toggled, given a few fields, and is then actually callable.

Carol Ann proved the pattern (skills toggle, config, export an MCP stack JSON; a connector that is not live says demo; agents share a bus). Rebuild a smaller registry inside `packages/web`, original code. Live entries go through `/api/mcp`. Antigravity receives only the live ones, via `mcp_server` plus the Credentials API. Ship the owner's crew presets first. A connector that is not live says demo. Do not build voice in this cut.

## PWA

Manifest and shell worker already exist. Still required:

- `navigator.storage.persist()` after install.
- Manifest shortcuts: Chat, Crew, Knowledge. Share target for `.md` and `.txt`.
- Dock copy when offline: hosted models need the network; local models work only if Ollama is up.
- One update toast when a new service worker is waiting. No nag.
- iOS: one Add to Home Screen note only if iOS and not already standalone. No App Store link.

## Storage decision (this cut)

The live service has no disk. SQLite at `DATA_FILE=/tmp` dies on restart. **Choice: the monthly credit ledger lives in the browser.** The server does not claim to remember quotas. The in-memory `FREE_MAX_PER_HOUR` cap is the only server-side spend bound, and it dies with the process. Admin settings written to ephemeral SQLite do not survive; the dashboard says so.

OpenRouter, Hugging Face, and the Antigravity key are not written to that database. They stay in this browser. They may be saved as admin secrets only when storage is durable (Postgres via `DATABASE_URL`, or a `DATA_FILE` outside `/tmp`). Even then they are excluded from `shieldProviders()` and the free-tier allowlist.

## Build order that this cut followed

1. Replace this brief.
2. Honest browser ledger (above). README matches.
3. Experiment lane.
4. Antigravity execution route, own secret, token cap, streamed into the run card.
5. Skills registry.
6. PWA polish and the local-model Test button.
7. Branch one message, and a visible deletable "what this crew remembers" list.

## Verify

From `packages/web`: `npm test`, `npm run test:server`, `npm run build`. Check a 400px-wide layout. A 200 from curl is not done.
