# Third-party notices

## FreeToken

Source: https://github.com/chrisfbaileycb-arch/FreeToken
Base commit: `58f4b9ec0e166205c4dfd0c6ec184ea83b5957e6`
License: Apache-2.0, retained at repository root and `public/licenses/FREETOKEN-APACHE-2.0.txt`.

The new `web/` edition adds a browser UI and hosted API integration. It does not compile or embed the upstream Python/CUDA inference engine.

## Ruflo

Source: https://github.com/chrisfbaileycb-arch/ruflo
Commit: `72df96c297142d5518254650f28956e0844c7daf`
Copyright (c) 2024-2026 ruvnet. MIT license retained in `public/licenses/RUFLO-MIT.txt`.

Vendored modules:

- `v3/@claude-flow/swarm/src/domain/entities/agent.ts` → `src/vendor/ruflo/agent.ts`
- `v3/@claude-flow/swarm/src/domain/entities/task.ts` → `src/vendor/ruflo/task.ts`
- `v3/@claude-flow/memory/src/json-security.ts` → `src/vendor/ruflo/json-security.ts`

Agent/Task changes replace Node `crypto.randomUUID` imports with browser Web Crypto. The capability-match selection in `src/lib/orchestrator.ts` is adapted from Ruflo's CoordinationService. Scheduling, provider transport, browser persistence, UI, and SSE proxy are newly implemented. This is a portable subset, not a claim of full Ruflo feature parity.

React, Vite, Vitest, TypeScript and Lucide retain their respective package licenses; exact dependency versions are recorded in package-lock.json.

## Agency Agents engineering catalog

Source: https://github.com/msitarzewski/agency-agents
Pinned commit: `f99f6aa910a442b0197b768ce0ea7751e35e2060`.
All 65 Markdown definitions from the engineering directory are retained byte-for-byte in
`public/skills/agency` and in the indexed catalog. Each entry retains its SHA-256 and source
URL. The upstream MIT license is included in `public/skills/agency/LICENSE` and each package's
`resources/LICENSE.txt`. The instruction packages do not install or execute upstream scripts.

## Isolated React preview runtime

The preview worker bundles the matching React, ReactDOM and Scheduler production modules from
the installed package versions. They execute inside the generated iframe, with no references to
the parent app's React instance. Their upstream package licenses remain in node_modules and the
versions are locked in package-lock.json. WebSocket transport uses the MIT-licensed `ws` package.
