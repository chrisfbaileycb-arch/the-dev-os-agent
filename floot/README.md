# Floot edition (source mirror)

Floot project id: `599da6cf-0aa2-48c3-8788-206be3f30c05` (name: Hey Buddy).

Floot cannot import a repository, so its project files are authored through the Floot MCP and mirrored here so the rebuild is versioned alongside the original `web/` app. Paths follow Floot's item scheme: `pages/<route>.tsx` + `.module.css` + `.pageLayout.tsx`, `components/Name.tsx` + `.module.css`, `helpers/name.tsx`, `endpoints/<route>_<METHOD>.ts` + `.schema.ts`, `base.css`, `static/__dev/*`.

Files that Floot seeds itself (the component kit, auth pages, `helpers/db`, `helpers/schema`, `helpers/useAuth`, and so on) are not mirrored; only files this project authored or changed are.

The spec for this edition is `../docs/floot-rebuild-brief.md`. The database schema lives in `static/__dev/schema.sql`.

## Installable app (Chrome OS)

`static/manifest.json` is served at `/manifest.json` and, together with the icon links `components/AppShell.tsx` sets through react-helmet, makes the published app installable from Chrome on a Chromebook or any desktop. Floot forbids service workers (it ships its own for push), so this edition has no offline shell; the `web/` edition carries that. The icons are Hey Buddy's own set, uploaded to Floot Storage and referenced by their `/_cdn/static/...` paths in the manifest and the shell; the project's `iconUrl` metadata points at the 512 px icon. `helpers/useInstallPrompt.tsx` captures Chrome's install prompt so Settings can show an **Install app** button.

## Composer tools (MCP servers, attachments, microphone)

The goal box on the workspace page carries a tool dock: **Attach files** (text, Markdown, CSV, JSON, or HTML under 200 KB; up to six), **Add photos** (up to five; resized in the browser to 1280 px JPEG by `helpers/attachments.tsx`), **Microphone** (Web Speech API through `helpers/useVoiceInput.tsx`; the button is disabled with a hint where the browser lacks it), and **MCP servers**. Files and photos can also be dropped or pasted onto the goal box, and each shows as a chip that can be removed before launch.

Text attachments join the run as context notes. Photos ride along as image parts on the Planning and Research stages; `endpoints/chat_POST.schema.ts` accepts message content as text or an array of text and image parts, `endpoints/chat_POST.ts` allows a 12 MB body, and `helpers/proxyProvider.tsx` refuses photos for Cohere native chat, which has no image input here.

MCP servers are managed in a dialog: name, https URL, optional bearer token, and a **Remember token** switch (tokens stay in memory for the session unless remembered; the list itself lives in localStorage under `hb-mcp`). `helpers/useMcpServers.tsx` lists tools through `endpoints/mcp_POST.ts`, a stateless Streamable HTTP proxy that runs the initialize handshake on every request, allows only public https hosts, follows no redirects, and shares the per-client rate limit. Enabled tools become `ToolSpec`s that `helpers/executeRun.tsx` offers to the Research stage under the `TOOL {"tool", "args"}` protocol, at most three calls per stage, with a trace appended to the stage output.
