# Floot edition (source mirror)

Floot project id: `599da6cf-0aa2-48c3-8788-206be3f30c05` (name: Hey Buddy).

Floot cannot import a repository, so its project files are authored through the Floot MCP and mirrored here so the rebuild is versioned alongside the original `web/` app. Paths follow Floot's item scheme: `pages/<route>.tsx` + `.module.css` + `.pageLayout.tsx`, `components/Name.tsx` + `.module.css`, `helpers/name.tsx`, `endpoints/<route>_<METHOD>.ts` + `.schema.ts`, `base.css`, `static/__dev/*`.

Files that Floot seeds itself (the component kit, auth pages, `helpers/db`, `helpers/schema`, `helpers/useAuth`, and so on) are not mirrored; only files this project authored or changed are.

The spec for this edition is `../docs/floot-rebuild-brief.md`. The database schema lives in `static/__dev/schema.sql`.

## Installable app (Chrome OS)

`static/manifest.json` is served at `/manifest.json` and, together with the icon links `components/AppShell.tsx` sets through react-helmet, makes the published app installable from Chrome on a Chromebook or any desktop. Floot forbids service workers (it ships its own for push), so this edition has no offline shell; the `web/` edition carries that. The icons are Hey Buddy's own set, uploaded to Floot Storage and referenced by their `/_cdn/static/...` paths in the manifest and the shell; the project's `iconUrl` metadata points at the 512 px icon. `helpers/useInstallPrompt.tsx` captures Chrome's install prompt so Settings can show an **Install app** button.
