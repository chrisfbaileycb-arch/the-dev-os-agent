# the-dev-os-agent

Browser-based multi-agent workspace: a five-agent DAG (planner, researcher and architect in parallel, reviewer, synthesizer) built on a browser-adapted subset of the Ruflo Agent/Task entities, with hosted inference through a unified streaming proxy for OpenRouter, Groq, Cohere, and OpenAI-compatible custom endpoints.

The application lives in [`web/`](web/). Read [`web/README.md`](web/README.md) for the architecture, API contract, environment variables, security boundaries, and verification steps.

## Layout

```
web/            Vite + React 19 front end, Web Worker orchestrator, Node 22 SSE proxy server
web/server/     index.mjs (static + API on one origin), proxy.mjs (provider routing, SSRF guards, rate limit)
web/src/vendor/ruflo/   Browser-adapted Ruflo Agent and Task domain entities
web/tests/      vitest unit tests and node:test server tests (mocked upstreams, no paid calls)
render.yaml     Render Blueprint (Node web service, root dir web/)
.github/workflows/web.yml   CI: npm ci, npm test, npm run test:server, npm run build
```

## Run locally

Requires Node 22 or newer.

```sh
cd web
npm ci
npm run dev        # Vite dev server with the API proxy wired in
npm test           # unit tests
npm run test:server
npm run build && npm start   # production server on PORT (default 4173)
```

## Hosting

The server streams provider responses as Server-Sent Events, so the host must run a long-lived Node process (or a container) and must not buffer responses. Static-only hosting and buffered serverless routers cannot serve `/api/chat`.

- **Render**: connect this repository and Render reads `render.yaml`. Set `APP_ORIGIN` to the service URL.
- **Any container host**: build `web/Dockerfile`; the image listens on port 8080.
- **Any Node host**: from `web/`, run `npm ci && npm run build && npm start`.

Copy `web/.env.example` for the full list of server environment variables. Never prefix secrets with `VITE_`.

## Licenses

Apache 2.0 for this project (see [`LICENSE`](LICENSE)). Third-party notices, including the MIT-licensed Ruflo subset, are in [`web/THIRD_PARTY_NOTICES.md`](web/THIRD_PARTY_NOTICES.md).
