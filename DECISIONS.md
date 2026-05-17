# Architecture Decisions

> A running log of non-obvious technical decisions made while building this project, why they were made, and what was given up.
>
> This file exists so I can talk fluently about the project in interviews. Each entry follows a lightweight ADR (Architecture Decision Record) format. The **Why** sections are written in my own words — the hints in italics are prompts I rewrote past.

---

## Template

```
## N. <Decision title>
**Date:** YYYY-MM-DD
**Status:** Accepted | Superseded by #M | Reversed

**Context.** What problem are we solving? What forces are at play?

**Options considered.**
- Option A — short description
- Option B — short description
- Option C — short description

**Decision.** What we picked, in one sentence.

**Why (in my own words).**
[Your reasoning — what convinced you. ~2–4 sentences.]

**Tradeoffs / what we're giving up.**
[What's worse about this choice vs alternatives. ~1–2 sentences.]
```

---

## 1. Supabase as the backend platform
**Date:** 2026-05-16
**Status:** Accepted

**Context.** The app needs auth, a relational database, file storage, and an API surface. Building these from scratch is weeks of work before the actual product features start.

**Options considered.**
- **Firebase** — Google's BaaS. Most mature option; uses Firestore (NoSQL).
- **Supabase** — open-source Firebase alternative built on Postgres.
- **Roll our own** — Node/Express + Postgres + auth library + S3 storage.
- **AWS Amplify** — Cognito + DynamoDB + S3, similar BaaS pattern.

**Decision.** Supabase.

**Why (in my own words).**
*Hints to weave into your answer:*
- *Postgres skills transfer to any future role; Firestore's NoSQL model doesn't.*
- *Row Level Security gives database-enforced multi-tenant authorization — a feature unique to Postgres-based BaaS.*
- *Free tier comfortably covers a portfolio project.*

---

## 2. Row Level Security over application-layer authorization
**Date:** 2026-05-16
**Status:** Accepted

**Context.** The app is multi-user. Each user should only see and modify their own gardens, plants, and photos. Authorization has to be enforced somewhere.

**Options considered.**
- **Application-layer filters** — every query in the app code adds `WHERE user_id = ?`.
- **Postgres Row Level Security (RLS)** — define policies on tables; the database silently filters every query.
- **API gateway / middleware filter** — single point that re-checks auth and rewrites queries.

**Decision.** Postgres RLS, with a defense-in-depth `getUser()` check in the layout.

**Why (in my own words).**
*Hints:*
- *App-layer authz has a failure mode: forget a `WHERE` clause once, leak everyone's data. RLS makes the database itself the wall.*
- *Single source of truth for "who can see what" — lives in migrations, version-controlled, reviewable.*
- *Encodes intent at the data layer, where data leaks actually happen.*

**Tradeoffs / what we're giving up.**
*Hints:*
- *RLS policies can be slower than indexed `WHERE user_id` queries on huge tables (irrelevant at this scale).*
- *Harder to debug — "why is this query returning nothing?" sometimes means "RLS is filtering it out."*

---

## 3. Next.js App Router (server components) over Angular
**Date:** 2026-05-16
**Status:** Accepted

**Context.** I have 10 years of Angular and need a modern fullstack framework for this project. Resume goal: fill the gap of "no modern React/Next.js exposure."

**Options considered.**
- **Angular 18+ with SSR** — comfortable, no learning curve, but already on my resume twice.
- **Next.js 15 App Router** — new to me, dominant in 2026 React ecosystem.
- **Remix / React Router 7** — also fullstack React, smaller community.

**Decision.** Next.js 15 App Router with server components and server actions, minimizing client-component usage to reduce React-y mental load.

**Why (in my own words).**
*Hints:*
- *Resume gap — Angular adds nothing new; Next.js App Router is conspicuously absent from my background.*
- *Server components let me write data-fetching pages in a feel-like-Razor-Pages style — closer to my .NET MVC habits than to SPA-style React.*
- *Default deployment target on Vercel pairs naturally with the rest of the stack.*

**Tradeoffs / what we're giving up.**
*Hints:*
- *Steeper learning curve in week 1 (the auth flow especially).*
- *Less mature than Angular's enterprise toolchain (testing, i18n, accessibility lint).*

---

## 4. Pl@ntNet API for plant identification, not iNaturalist
**Date:** 2026-05-16
**Status:** Accepted

**Context.** The app needs to identify a plant species from a user-supplied photo.

**Options considered.**
- **iNaturalist computer-vision API** — initially planned, but their CV endpoint isn't publicly accessible (requires special access tokens not granted to third-party devs).
- **Pl@ntNet API** — open developer API, 500 IDs/day free tier, multipart upload, JSON response with ranked species candidates.
- **Self-hosted model** (e.g., TensorFlow + iNat-21 dataset) — full control but adds ML ops to scope.

**Decision.** Pl@ntNet for identification; keep iNaturalist for taxonomy enrichment and optional observation publishing.

**Why (in my own words).**
*Hints:*
- *Discovered during research that iNaturalist's CV API isn't actually open — pivoted to what's actually available.*
- *Pl@ntNet has a real, documented developer program with reasonable rate limits.*
- *Splitting "identification" from "taxonomy + community publishing" across two providers is actually a stronger architecture story than relying on one.*

**Tradeoffs / what we're giving up.**
*Hints:*
- *Dependence on two third-party services means two failure modes.*
- *500/day rate limit caps free-tier usage; would need a paid plan or self-hosted model to scale.*

---

## 5. Magic-link auth over password auth (and over Google OAuth on day one)
**Date:** 2026-05-16
**Status:** Accepted

**Context.** Multi-user app needs sign-in. Choices vary in UX, security, and external setup cost.

**Options considered.**
- **Email + password** — universal, but I'd own password reset flows, breach risk, etc.
- **Magic link (passwordless email)** — Supabase generates a one-time URL.
- **Google OAuth** — easiest UX, but requires Google Cloud Console project + OAuth consent screen + brand verification.
- **Both magic link and Google OAuth** — strongest UX, but adds ~45min of external setup before any code runs.

**Decision.** Magic link only for MVP. Google OAuth can be added in a later commit (it's a 30-minute add).

**Why (in my own words).**
*Hints:*
- *Zero passwords to manage = zero password-breach class of bug.*
- *Works out of the box with Supabase; no Google Cloud Console setup blocking Day 2.*
- *Same UX from the user's perspective as "sign in with Google" once the email arrives.*

**Tradeoffs / what we're giving up.**
*Hints:*
- *Slightly higher friction per sign-in vs. a single Google click.*
- *Dependent on email deliverability — junk-mail filters can break the flow.*

---

## 6. GitHub Actions as deploy orchestrator (not Vercel's Git integration)
**Date:** 2026-05-16
**Status:** Accepted

**Context.** Need to deploy automatically on merge to `main`, run CI on PRs, and produce preview URLs.

**Options considered.**
- **Vercel Git auto-integration** — flip a switch in Vercel; every push deploys automatically. Zero config.
- **GitHub Actions calling Vercel CLI** — explicit workflow files in `.github/workflows/`; Vercel's auto-deploy disabled.
- **Manual `vercel deploy` from local** — no CI/CD at all.

**Decision.** GitHub Actions, with Vercel's "Ignored Build Step" set to `exit 0` to disable its auto-integration.

**Why (in my own words).**
*Hints:*
- *Workflow files in the repo become the documented deploy pipeline — visible, reviewable, version-controlled.*
- *Same workflows can apply Supabase migrations before deploying, which Vercel's integration doesn't do.*
- *Resume signal: "owns a real CI/CD pipeline" reads stronger than "uses Vercel's defaults."*

**Tradeoffs / what we're giving up.**
*Hints:*
- *More moving parts — secrets, permissions, workflow debugging.*
- *Marginally slower deploys (~30s overhead vs. Vercel's direct integration).*

---

## How to use this going forward

Whenever Claude and I make a non-obvious choice, Claude scaffolds the **Context**, **Options**, and **Decision** sections; I rewrite the *italic hints* in my own words into the **Why** and **Tradeoffs** sections. Goal: by Day 10, every entry is in my voice, and I can riff on any of them for 60 seconds in an interview.
