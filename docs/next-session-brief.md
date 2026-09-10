# Next session brief: Hey Buddy, web edition

Written at the end of the Floot rebuild session so the next session starts with the decisions made, the licences checked, and the owner's own material at the centre.

## 1. Where things stand

- `web/` is the original FreeToken Web x Ruflo app (Apache 2.0, with an MIT Ruflo subset). Reference implementation; runs on any Node host.
- `floot/` mirrors the Floot edition (project 599da6cf-0aa2-48c3-8788-206be3f30c05, live at https://freetoken-web-ruflo.floot.app). No accounts, browser-local storage, anonymous rate-limited proxy, buffered per-stage responses, typechecked and smoke-tested.
- The owner's own product is Hey Buddy (github.com/chrisfbaileycb-arch/Hey-Buddy.AI): a privacy-first AI companion PWA with five buddy personas, The Oracle daily mystery, a community scavenger hunt, encrypted BYOK keys, a phone-to-PC bridge, custom personas behind a safety baseline, an agent and workflow builder with a capability sandbox, an agent market, and a tier model. That is the voice, the audience, and the values. The next session converts the workspace into the web edition of Hey Buddy rather than a FreeToken clone.

## 2. The owner's intent, in their words

A comfortable web interaction platform that is a good option for people who cannot afford a 124 GB machine. Not a get-rich plan. Nothing plagiarised. More agent skills, ideas from LobeHub and AnythingLLM, and Hey Buddy folded in so the product becomes theirs again.

## 3. The honesty line, checked at the source on 2026-09-10

| Source | Licence | What is allowed here |
|---|---|---|
| FreeToken Web (zip) | Apache 2.0 | Use, modify, host. Keep the notice. |
| Ruflo subset (zip) | MIT | Use, modify, host. Keep the notice. |
| Hey Buddy (owner's repo) | Owner's own | Everything. This is the product. |
| AnythingLLM (Mintplex Labs) | MIT | Ideas freely; code too if the MIT notice is kept. |
| LobeHub / LobeChat | LobeHub Community License (Apache-based) | Run it as a service unmodified is fine; distributing a derivative work needs their commercial licence. So: ideas only, no code, credit them as inspiration. |
| Cherry Studio | AGPL-3.0 (commercial licence available) | Desktop-only Electron app; cannot be embedded in a web tab. Ideas only, no code. Copying code would make the hosted site AGPL. |

Rule for the whole project: original code and original prompts; every upstream named as inspiration in the README; notices kept for the two permissive sources actually carried in `web/`. The five FreeToken agent instructions and three workflow titles get replaced by Hey Buddy voice, which removes the last borrowed prose.

## 4. What Hey Buddy contributes (the owner's assets, ready to reuse)

Taken from the repo's own modules and copy. All of it is the owner's and can be lifted directly.

- **Brand line.** "Your AI crew. Always in your corner."
- **The crew.** The Drill (ruthless with your goals, every word kind), Haven (the one you can talk to at 2am, no judgment), The Ledger (your commitments, tracked; no punishment, just honesty), Coach (calm, intense, or science-based; same knowledge, different energy), First Responder, and The Oracle (a new mystery every day, one winner worldwide). Each has guardrails in `security/guardrails.js`: blocked patterns, a crisis path for Haven, a disclaimer for Coach, and a rule that The Oracle never uses personal information in clues.
- **Safety baseline** (`persona-guard.js`): every custom persona's prompt is prepended with a fixed kindness-and-safety preamble that wins on conflict, points people in crisis to 911 and 988, and says the buddy is not a doctor, lawyer, or emergency service. This is the moral core and should be the first thing any agent in the web edition sees.
- **Privacy contract** (landing copy): zero data leaving the device by default, conversations encrypted in origin-scoped storage, API keys AES-256-GCM encrypted on device, a visible badge whenever a message routes to a cloud provider, one button that destroys everything, no account required.
- **Agent platform** (`agent-spec.js`, `agent-builder.js`, `workflow-engine.js`, `fleet-presets.js`, `agent-market.js`): agent specs with a capability allow-list (http_request, web_scrape, schedule_cron, notify_user, storage_read, storage_write), trigger types (manual, cron, webhook, chat command), DAG workflows with `{{step.output}}` interpolation and topological ordering, starter presets, and a browsable market of agent and workflow templates.
- **Bridge** (`bridge-client.js`, `bridge-pairing.js`, `BRIDGE_DESIGN.md`): phone to home PC over LAN, then an end-to-end encrypted relay with P-256 ECDH pairing by QR. "Message-taker, not actor" is the invariant. This is the answer to the 124 GB problem for people who do own a PC: the web app talks to the model at home; the relay sees only ciphertext.
- **Tiers** (`tier-config.js`): free trial credits, BYOK Pro membership, and the rule that anyone using their own key is never charged credits. Tasteful upgrade prompts, never aggressive.
- **Community layer** (`hunt-engine.js`, `park-moment.js`): a daily deterministic scavenger hunt and an opt-in "say hi" nudge for nearby players. Out of scope for the workspace's first cut, but it is what makes Hey Buddy a companion rather than a console.

Two adjustments when bringing these over: Hey Buddy's presets use emoji avatars, and the web edition's design rules use lucide icons only, so each avatar becomes an icon name; and the encrypted-storage layer (`security/storage.js`, `security/crypto.js`) should replace the Floot edition's plain IndexedDB helper.

## 5. Ideas worth re-implementing from LobeHub and AnythingLLM (ideas only)

From AnythingLLM (MIT): workspaces that hold documents and chats together; drag-and-drop ingestion of PDF, DOCX, and text with source citations in answers; agent skills the user switches on per workspace; dynamic model routing by rule (cheap model for short questions, strong model for long tasks); an embeddable chat widget for a website; user-managed memories.

From LobeHub (ideas only): an agent marketplace with one-click install and an agent builder that auto-configures from a short description; agent groups that work in parallel on one task; scheduling so agents run when the user is away; structured, editable personal memory; branching conversations; artifacts rendered beside the chat; text-to-speech on any reply.

Hey Buddy already has the market, builder, scheduling triggers, and memory scopes in spec form. The web edition's job is to make them run in a hosted tab.

## 6. The expanded crew: agent skills for the web edition

Skills are named roles with a capability allow-list, in the owner's voice. Each ships with a system prompt written fresh, the safety baseline prepended.

| Skill | Job | Capabilities |
|---|---|---|
| The Drill | Goal pressure with kindness; turns a vague wish into a plan with dates | notify_user, storage_read |
| Haven | Presence at 2am; listens, reflects, never diagnoses; crisis path to 988 | none |
| The Ledger | Tracks commitments the user states; asks what got in the way; no punishment | storage_read, storage_write |
| Coach | Health and habit guidance in three styles; always carries the disclaimer | storage_read |
| First Responder | Calm triage for real-world problems; points to real help fast | notify_user |
| The Oracle | Daily riddle host; clues cost; never uses personal data | storage_read |
| Researcher | Reads supplied notes and approved pages; never invents sources | web_scrape, storage_read |
| Architect | Designs a solution with interfaces and tradeoffs | storage_read |
| Reviewer | Challenges the work for correctness and safety | none |
| Scribe | Turns any thread into a clean note, letter, or post | storage_write |
| Translator | Plain-language rewrite for seniors and non-native readers; large-print aware | none |
| Dispatcher | Runs a workflow DAG, assigns steps to skills, reports progress | schedule_cron, notify_user |

The three workflows become Hey Buddy verbs: Plan it (Drill, Researcher and Architect, Reviewer, Scribe), Look into it (Researcher twice from two angles, Reviewer, Scribe), Check my work (Reviewer, Architect, Ledger, Scribe).

## 7. System prompt for the next session

You are continuing work on the-dev-os-agent repo. The product is Hey Buddy, web edition: a hosted, browser-only, privacy-first AI companion and multi-agent workspace so people without expensive local hardware can use frontier and open models with their own keys, and people with a PC at home can reach it from their phone through the encrypted bridge. Ground rules. (1) Original code and original prompts only. Credit FreeToken, Ruflo, AnythingLLM, LobeHub, and Cherry Studio as inspiration in the README; keep the Apache and MIT notices already in web/; copy no source from LobeHub or Cherry Studio because their licences do not permit derivative distribution here. (2) The owner's Hey Buddy repo is the source of truth for names, personas, guardrails, safety baseline, privacy contract, agent spec, workflow engine, tiers, and bridge design. Reuse it freely; it is theirs. (3) Rename the product from FreeToken to Hey Buddy and replace the five FreeToken agent instructions and three workflow titles with the crew and verbs in docs/next-session-brief.md section 6, safety baseline first in every prompt. (4) Keep no-accounts and browser-local storage; adopt Hey Buddy's encrypted storage and key handling; show a visible badge whenever a message routes to a cloud provider. (5) Emoji are banned in this codebase; map Hey Buddy's emoji avatars to lucide icons. (6) The Floot edition is the deployment target; web/ is the reference; floot/ must be mirrored in the repo after every Floot change; verify with typecheck, a headless endpoint smoke test, and a screenshot before reporting done. (7) Build order: rename and re-voice; port the safety baseline and guardrails; add the skill roster and the three verbs; add the agent market and builder from Hey Buddy's spec; then AnythingLLM-style document workspaces with citations; then the bridge as a provider option. Stop and ask before adding tiers, payments, or the community layer.
