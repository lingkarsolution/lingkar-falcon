# AGENTS.md

## Project summary

A full-stack **starter template** for Dark Factory projects. React 19 + Vite frontend with shadcn/ui, a Fastify API gateway backend, and a sample Dashboard UI — designed to be cloned and extended into a real product. Deployable to Azure Web App (multi-stage Docker).

## Tech stack

| Layer | Stack |
|---|---|
| Frontend | React 19, Vite 6, TypeScript 5.7 strict, Tailwind v4, shadcn/ui (New York, zinc), React Router v7, TanStack Query v5, Recharts, Lucide |
| Backend | Node 20, Fastify 5, `@fastify/cors` + `@fastify/helmet` + `@fastify/rate-limit`, TypeScript 5.8 strict |
| Deploy target | Azure Web App / Container Apps (monorepo, two workspaces) |

## Key files

- `src/App.tsx` — router root; two routes: `/` → Dashboard, `/analytics` → Analytics
- `src/main.tsx` — app entry; wraps in `QueryClientProvider` + `ThemeProvider` (no extra BrowserRouter — router lives in App.tsx)
- `src/index.css` — Tailwind v4 `@import`, full CSS variable theme (light + dark)
- `src/lib/theme.tsx` — `ThemeProvider` context; persists to localStorage, defaults to OS preference
- `src/components/layout/AppLayout.tsx` — sidebar + topbar shell; includes `ThemeToggle`
- `src/pages/Dashboard.tsx` — sample dashboard (stats, chart, activity, goals)
- `src/pages/Analytics.tsx` — placeholder analytics page
- `server/src/index.ts` — Fastify server entry; registers all plugins and routes
- `server/src/routes/config.ts` — `GET /api/config` — reads env vars, returns safe app config
- `server/src/routes/health.ts` — `GET /api/health`
- `server/src/routes/example.ts` — `GET /api/example`
- `vite.config.ts` — `@tailwindcss/vite` plugin + `@` path alias + `/api` proxy to Fastify dev server
- `components.json` — shadcn config (New York style, zinc, Tailwind v4, `@/` aliases)

## Architecture & conventions

- **Single BrowserRouter** — lives in `App.tsx` only. `main.tsx` must NOT wrap in another router.
- **Semantic color tokens** — always use `text-foreground`, `text-muted-foreground`, `bg-card`, `bg-background`, `border-border`, `bg-sidebar`, `text-sidebar-foreground` etc. Never use `text-primary`/`bg-surface`/`text-secondary` (those map to brand palette, not theme-aware tokens).
- **Theme** — CSS variables in `index.css` define both `:root` (light) and `.dark` overrides. `ThemeProvider` toggles the `dark` class on `<html>`.
- **API** — all backend routes are under `/api`. Vite dev proxy forwards `/api` → Fastify server.
- **Config API** — driven by env vars: `APP_NAME`, `APP_VERSION`, `FEATURE_ANALYTICS_ENABLED`, `FEATURE_MAINTENANCE_MODE`.

## Commands

```bash
# Frontend
pnpm install          # install all deps
pnpm dev              # start Vite dev server
pnpm typecheck        # tsc --noEmit

# Backend
cd server
pnpm install
pnpm dev              # tsx watch src/index.ts
pnpm build            # tsc
```

## Decision log

- 2025-05 — Used Fastify 5 (not Express) for backend — better TypeScript support and built-in schema validation.
- 2025-05 — Tailwind v4 with `@tailwindcss/vite` plugin (not PostCSS) — matches shadcn New York template.
- 2025-05 — `tw-animate-css` installed separately — it's imported in `index.css` but not auto-installed by shadcn CLI.
- 2025-05 — Removed duplicate `<BrowserRouter>` from `main.tsx` — nested routers caused blank page.
- 2025-05 — Replaced hardcoded brand color tokens with shadcn semantic tokens throughout layout and dashboard — ensures correct rendering in both light and dark mode.

## Known issues / TODO

- Analytics page is a placeholder — needs real content.
- No Dockerfile yet — needed before Azure deploy.
- No auth wired — add `@azure/msal-react` when auth is required.

## Memory

- User wants `tw-animate-css` always installed alongside shadcn — it's a peer dep not auto-resolved.
- Env vars for config API must be set via the Env panel (platform API not reachable from inside container shell).
- Do NOT run `vite` commands in exec — platform blocks the string "vite" in shell commands.
