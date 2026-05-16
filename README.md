# 🌱 Garden

Track plants across multiple gardens, identified by AI.

> **Status:** Day 1 scaffold. See [`PLAN.md`](../PLAN.md) for the full architecture and 10-day build plan.

## Stack

- **Frontend / API** — Next.js 15 App Router, TypeScript, Tailwind CSS v4
- **Database** — Postgres + PostGIS on Supabase, with Row Level Security
- **Auth** — Supabase Auth (magic link + Google OAuth)
- **Plant identification** — Pl@ntNet API
- **Taxonomy + observation publishing** — iNaturalist v1 API
- **Hosting** — Vercel
- **CI/CD** — GitHub Actions

## Local development

Prereqs: Node 20+, pnpm 9+, a Supabase project, a Pl@ntNet API key.

```bash
pnpm install
cp .env.local.example .env.local
# fill in Supabase + Pl@ntNet values
pnpm dev
```

App boots at http://localhost:3000.

## Project layout

```
garden-app/
├── src/
│   ├── app/                  # App Router pages and route handlers
│   │   ├── api/health/       # Liveness endpoint (used by deploy smoke test)
│   │   ├── globals.css       # Tailwind v4 entry
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── lib/
│   │   └── supabase/         # Supabase client/server/middleware helpers
│   └── middleware.ts         # Next.js middleware (auth session refresh)
├── .env.local.example
├── next.config.ts
└── package.json
```

## CI/CD

Three GitHub Actions workflows live in `.github/workflows/` (added later in Day 8):

- `ci.yml` — lint, typecheck, test, build on every PR
- `preview.yml` — per-PR Supabase branch + Vercel preview deploy
- `deploy.yml` — production deploy + post-deploy smoke test on merge to `main`

Vercel's Git auto-integration is **intentionally disabled** so Actions is the single source of truth.
