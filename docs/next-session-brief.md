# Next session brief: an honest, web-based multi-provider workspace

Written at the end of the Floot rebuild session so the next session starts with the decisions already made.

## Where things stand

- `web/` is the original FreeToken Web x Ruflo app (Apache 2.0 with an MIT Ruflo subset). It runs on any Node host; Render blueprint included.
- `floot/` mirrors the Floot edition (project id 599da6cf-0aa2-48c3-8788-206be3f30c05, live at https://freetoken-web-ruflo.floot.app). No accounts, browser-local storage, anonymous rate-limited proxy, buffered per-stage responses.
- Third-party notices are preserved in `LICENSE` and `web/THIRD_PARTY_NOTICES.md`.

## The owner's goal, in their words

Make this web based instead of local based so people who cannot afford a 124 GB machine can use a serious multi-provider AI workspace. Do it without taking anyone's work: give the product its own name, its own prompts, and its own voice, and keep every upstream credit intact.

## Cherry Studio: what to take and what not to

Cherry Studio (github.com/CherryHQ/cherry-studio) is a desktop client (Windows, macOS, Linux) with 300+ preset assistants, many providers, knowledge bases, MCP support, and document handling. Community Edition is AGPL-3.0; a paid commercial licence exists (bd@cherry-ai.com).

Consequences for a hosted web product:

1. Copying Cherry Studio code into this app makes the whole hosted service AGPL: the full source must be offered to every user of the site. That is compatible with the repo being public, and incompatible with any closed commercial layer later, unless the commercial licence is bought.
2. Cherry Studio is Electron plus a desktop runtime. It does not run in a browser tab. "Incorporating" it means re-implementing ideas, not embedding it.
3. The ideas worth re-implementing, none of which are copyrightable as ideas: a preset-assistant library, per-provider adapters behind one chat contract, a knowledge base with document ingestion, MCP tool connections, topic-based conversation management.

Recommended stance: original code, Cherry Studio credited as inspiration in the README, no copied source. Then the AGPL question never arises and the product can be licensed however the owner chooses.

## Suggested system prompt for the next session

You are continuing work on the-dev-os-agent repo. The product is a hosted, browser-only multi-agent AI workspace so people without expensive local hardware can use frontier and open models with their own keys. Ground rules: (1) write original code and original prompts; credit FreeToken, Ruflo, and Cherry Studio as inspiration in the README and keep their notices, but copy no source from Cherry Studio because it is AGPL-3.0 and this is a hosted service; (2) rename the product away from FreeToken and give the five agents and three workflows new names and new instructions in the owner's voice; (3) keep the no-accounts, browser-local model unless the owner asks for accounts; (4) the Floot edition is the deployment target, the `web/` app is the reference implementation, and `floot/` must stay mirrored in the repo after every Floot change; (5) verify with Floot's typecheck, a headless endpoint smoke test, and a screenshot before reporting done; (6) no emoji anywhere, lucide icons only. First task next session: rename and re-voice, then add a preset assistant library and provider adapters inspired by Cherry Studio, implemented from scratch.
