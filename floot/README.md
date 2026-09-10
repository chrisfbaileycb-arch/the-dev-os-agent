# Floot edition (source mirror)

Floot project id: `599da6cf-0aa2-48c3-8788-206be3f30c05` (name: FreeToken Web x Ruflo).

Floot cannot import a repository, so its project files are authored through the Floot MCP and mirrored here so the rebuild is versioned alongside the original `web/` app. Paths follow Floot's item scheme: `pages/<route>.tsx` + `.module.css` + `.pageLayout.tsx`, `components/Name.tsx` + `.module.css`, `helpers/name.tsx`, `endpoints/<route>_<METHOD>.ts` + `.schema.ts`, `base.css`, `static/__dev/*`.

Files that Floot seeds itself (the component kit, auth pages, `helpers/db`, `helpers/schema`, `helpers/useAuth`, and so on) are not mirrored; only files this project authored or changed are.

The spec for this edition is `../docs/floot-rebuild-brief.md`. The database schema lives in `static/__dev/schema.sql`.
