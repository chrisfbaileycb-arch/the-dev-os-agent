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
