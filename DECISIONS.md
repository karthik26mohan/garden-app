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
**Status:** Reversed — see Entry #8 (decided 2026-05-20 to switch back to Angular)

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

## 7. SCSS with component-scoped styles over Tailwind CSS
**Date:** 2026-05-20
**Status:** Accepted

**Context.** Picking a styling approach for the Angular project. The team needed a system that's productive, maintainable, and matches the engineer's existing CSS muscle memory.

**Options considered.**
- **Tailwind CSS (utility-first)** — thousands of pre-made utility classes composed directly in templates. Modern, fast to prototype, but every element ends up with long class strings.
- **SCSS with component-scoped styles** — Angular's idiomatic pattern. Each component owns its own `.scss` file; selectors stay local thanks to Angular's view encapsulation. SCSS adds nesting, variables, and mixins on top of plain CSS.
- **Plain CSS** — same as SCSS minus nesting and variables. Verbose for non-trivial UIs.
- **CSS-in-JS / styled-components** — popular in React; not idiomatic in Angular and adds a runtime cost.

**Decision.** SCSS with component-scoped styles (Angular's default), plus a small set of design tokens (colors, spacing) defined as CSS custom properties in `src/styles.scss`.

**Why (in my own words).**
*Hints:*
- *A decade of Angular projects has trained the muscle memory for "write component template, write component styles in a sibling file." Tailwind's utility-class-in-template pattern fights that habit.*
- *Component-scoped SCSS gives encapsulation for free — styles can't leak from one component into another. That's a property Tailwind doesn't have because it leans on global utility classes.*
- *Tried Tailwind for ~10 minutes and the long class strings felt alien. SCSS is the path that gets me building features instead of staring at class names.*

**Tradeoffs / what we're giving up.**
*Hints:*
- *Slightly more files on disk (one `.scss` per component) and the cognitive load of choosing class names.*
- *Tailwind has stronger "no design talent required" defaults — picking custom CSS values means I have to make more aesthetic decisions myself.*

---

## 8. Reversed: switched back from Next.js to Angular 21 with SSR
**Date:** 2026-05-20
**Status:** Accepted (supersedes Entry #3)

**Context.** Four days into the Next.js build (auth flow, schema, RLS, garden CRUD all working), it became clear the React paradigm itself — server vs client components, hooks, the cookie/middleware dance, `"use client"` / `"use server"` directives — was costing more cognitive energy than the resume gap fill justified. Infrastructure friction was real but framework-agnostic; the framework friction was the actual drain. Continuing meant the most React-heavy work (camera capture, multi-step plant identification UI) was still ahead.

**Options considered.**
- **Push through with Next.js** — finish the original plan, eat the cognitive cost, ship the Next.js bullet on the resume.
- **Switch to Angular 21 + SSR** — rewrite UI layer only, keep Supabase schema/RLS/migrations/Pl@ntNet plan, lose the Next.js resume gap fill but gain a sustainable build pace and current-Angular skills (zoneless change detection, signals, SSR).
- **Switch to Remix or another React framework** — different React flavor; still React.
- **Abandon the project** — non-starter; the data and integration work was substantive.

**Decision.** Switch to Angular 21 with SSR. Keep Supabase project, all 7 migrations, RLS policies, the Pl@ntNet research, the GitHub Actions workflows (with build-command adjustments), and DECISIONS.md. Wipe the Next.js scaffold and rebuild the UI in Angular.

**Why (in my own words).**
*Hints:*
- *The framework was supposed to be a means to an end — building the actual product (plant tracking, ML integration, multi-tenant data). When the framework starts eating the energy that should go to the product, the framework is the wrong tool, regardless of resume value.*
- *Reversing a stated decision when new information arrives is senior-engineer behavior, not flip-flopping. Day 4 me had information Day 1 me didn't — that the React paradigm specifically was the source of friction, not the infrastructure around it.*
- *Angular 21 with zoneless change detection + signals + SSR is itself a "current Angular" skill that's not stale — the modern Angular my resume implies isn't quite what AngularJS-era Angular was. So the resume isn't actually as Angular-saturated as Entry #3 assumed.*

**Tradeoffs / what we're giving up.**
*Hints:*
- *The original Next.js resume gap fill is gone. Anyone scanning the resume now sees "Angular" three times instead of two, with "Next.js" once removed.*
- *Roughly 4–5 days of work (Days 1–4 in Next.js) was wiped. The data/integration design carries over but the UI code does not.*
- *Slight signaling cost: a hiring manager who pokes deep into the git history could see "candidate started in Next.js, switched mid-project." That story plays as either "sunk-cost-aware engineer" or "couldn't hack it" depending on how it's told. Owning the reversal in DECISIONS.md and on the resume is how you control the framing.*

---

## 9. Custom SMTP via Resend for magic-link emails
**Date:** 2026-05-22
**Status:** Accepted

**Context.** Magic-link sign-in depends on Supabase actually delivering the email. Supabase's built-in email sender is meant for prototyping only — it's aggressively rate-limited (around 2 emails per hour per recipient, ~30/hour project-wide) and the limit applies to *every* code path that sends, including the "Send magic link" button in the dashboard. Hit the limit once during testing and the entire auth flow is unblockable for an hour, with no override.

**Options considered.**
- **Stay on Supabase's built-in sender** — zero setup, but testing becomes impossible after a couple of clicks.
- **Resend** — modern transactional-email SaaS, generous free tier (3,000/month, 100/day), straightforward SMTP credentials, a sandbox sender (`onboarding@resend.dev`) that works without domain verification for dev.
- **SendGrid** — incumbent. More features, much heavier setup, dashboard feels enterprise-clunky.
- **Postmark** — also good, but free tier is more restrictive (100 emails total, then paid).
- **Amazon SES** — cheapest at scale, but requires AWS account, sandbox-mode approval, DKIM/SPF setup before the first email lands.
- **Self-host (Postfix on a VPS)** — possible but deliverability is brutal; new IPs land in spam by default.

**Decision.** Resend, configured as Supabase's custom SMTP provider. Sender `onboarding@resend.dev` (sandbox) for development; domain verification deferred until a real custom domain is wired up.

**Why (in my own words).**
*Hints to weave into your answer:*
- *The built-in Supabase sender is unusable for any real testing — hit the rate limit once and you're locked out for an hour with no admin override.*
- *Resend's developer experience is dramatically better than SendGrid's — credentials in under five minutes, no enterprise onboarding flow.*
- *The `onboarding@resend.dev` sandbox sender means I can ship a working dev environment without owning a domain. Production gets a verified domain later, but that's a 20-minute job, not a blocker now.*
- *This isn't really an optional decision — every Supabase project that ships ends up here. The "built-in" sender is more like training wheels than a real option.*

**Tradeoffs / what we're giving up.**
*Hints:*
- *Sandbox sender can only deliver to the email I signed up to Resend with — any other test recipient gets rejected. Fine for solo dev, breaks the moment a second person tries to sign in.*
- *Added an external dependency (and one more service credential to manage) for a project that was otherwise self-contained inside Supabase + Vercel.*
- *Production cutover requires DNS records (SPF + DKIM) on a custom domain before any non-sandbox sender works — a small future-me task that's easy to forget about until launch day.*

---

## 10. Leaflet + Leaflet.Draw for the map UI
**Date:** 2026-05-24
**Status:** Superseded by #11 (decided 2026-05-24, before any Leaflet code was written)

**Context.** The `gardens` table has a `boundary` (polygon) and `centroid` (point) column, both `geography(_, 4326)`. The UI needs to (a) show a tile-based map for the user to find their location, and (b) let them draw a polygon for the garden footprint and place a single point for the centroid. The choice of library shapes the dev experience, bundle size, billing setup, and how the app looks.

**Options considered.**
- **Leaflet + Leaflet.Draw** — open-source (BSD), ~40KB, raster tiles via OpenStreetMap. No API key, no billing. Mature polygon-drawing plugin. Looks slightly dated but functionally rock-solid.
- **MapLibre GL JS** — open-source fork of Mapbox GL JS v1. ~200KB, vector tiles, sharper visuals, WebGL-rendered. Free tile providers (OpenFreeMap, Stadia, Versatiles) so no API key needed.
- **Mapbox GL JS** — proprietary since v2, real free tier (~50k loads/month), then $5/1000. API key required.
- **Google Maps JavaScript API** — best tile quality, $200/month free credit then $7/1000. API key with billing enabled required. ~1MB+ initial bundle.

**Decision.** Leaflet + Leaflet.Draw. Plain Leaflet without the `@asymmetrik/ngx-leaflet` wrapper — the wrapper hides Leaflet behind Angular abstractions that make the bundle larger and the docs less useful.

**Why (in my own words).**
*Hints to weave into your answer:*
- *Side projects die when the next step is "create a vendor account and add a credit card." Leaflet has zero friction — `npm install leaflet`, render a map.*
- *Bundle size matters: ~40KB Leaflet vs ~200KB MapLibre vs ~1MB Google. The map library shouldn't be the largest dependency in a small app.*
- *The primary interaction is polygon drawing. Leaflet.Draw is the most mature drawing plugin (10+ years of polish), and getting that UX right is more valuable than vector-tile sharpness.*
- *If vector tiles ever become important, MapLibre is a clean swap — its API is intentionally similar to Leaflet for migration. So "Leaflet now" doesn't preclude "MapLibre later."*

**Tradeoffs / what we're giving up.**
*Hints:*
- *Raster tiles look pixelated on aggressive zoom and on high-DPI (Retina) displays. Acceptable for a "where is my garden, here are its boundaries" use case; would matter more for a survey/mapping app.*
- *No vector-tile features — can't do smooth continuous zoom, custom styling at the tile layer, 3D rendering, or runtime style swaps. Probably never matters for this app.*
- *Leaflet is browser-only (touches `window` and `document` everywhere). Loading it has to be guarded with `isPlatformBrowser` to avoid blowing up SSR/prerender — already the pattern we use for Supabase, so not a new constraint.*

---

## 11. Plain-SVG property-relative editor (over Leaflet / geographic tiles)
**Date:** 2026-05-24
**Status:** Accepted (supersedes #10)

**Context.** Entry #10 chose Leaflet under the assumption that a "garden" was a thing you'd find on a world map — somewhere you'd want geographic tiles and lat/lng coordinates. Five minutes after picking Leaflet, the requirement got clarified: each garden is a 10×20 ft section of a backyard, ~9 per user, and the user wants to see them positioned **relative to their house**, not on a world map. Satellite tiles don't have useful resolution at the 50–100 ft scale, OpenStreetMap doesn't know the layout of a residential backyard, and lat/lng to 7 decimals is more precision than "approximately here in the yard" needs. Wrong abstraction.

**Options considered.**
- **Leaflet + OSM tiles** (original #10 pick) — geographic map. Wrong scale; tiles don't help at the backyard level.
- **Leaflet with `L.CRS.Simple` + a backdrop image** — Leaflet configured for non-geographic XY coordinates, plus an aerial photo of the property as the backdrop. Workable but heavy; uses a tile-based library to draw a single image.
- **Konva.js canvas editor** — purpose-built shape-editor library with drag/resize/rotate handles built in. ~150KB. Smooth interactions.
- **Plain SVG, drag/resize handled in component code** — no third-party library. SVG `<rect>` elements positioned absolutely; pointer events for drag/resize. ~200 lines of editor code.
- **Backdrop-image variant of any of the above** — user uploads an aerial screenshot of their property, shapes draw on top. Adds calibration UX + image upload.

**Decision.** Plain SVG, rectangles only, coordinates in feet relative to a fixed origin (one corner of the yard). No backdrop image for MVP — gardens render on a plain grid. House placement is a separate follow-up decision (own DECISIONS entry when we get there). The schema migrates from `geography(polygon, 4326)` / `geography(point, 4326)` to four plain numeric columns (`position_x_ft`, `position_y_ft`, `width_ft`, `height_ft`) — those PostGIS types are wrong for non-geographic data.

**Why (in my own words).**
*Hints to weave into your answer:*
- *The right tool follows the requirement, not the other way around. Once I knew each "garden" is a 10×20 ft plot in a backyard, every map-library option collapsed into "wrong scale." A 200-line SVG editor beats a 40KB library when the library was built for a problem you don't have.*
- *Zero dependencies for the editor means zero version-upgrade churn, zero bundle bloat, and the editor's behavior is fully under my control — every keypress and pointer event is in my own code.*
- *Rectangles are the right primitive for ~9 backyard garden plots. Most plots ARE rectangles. Once they aren't (kidney-shaped flowerbed, curving raised bed), I can graduate to polygons later — but that's a real "need three" moment, not a hypothetical now.*
- *Reversing Entry #10 within an hour of picking it is a good signal, not a bad one — it proves the decision journal is doing its job. The journal exists so the decision is reviewable; if no entry ever flips, the entries are rubber-stamps.*

**Tradeoffs / what we're giving up.**
*Hints:*
- *No real-world tiles means no "show the property on a world map" affordance for free. If that ever becomes useful (e.g., supporting multiple properties per user), we add a second view rather than rewriting the editor.*
- *No backdrop image means the editor feels more abstract — grid + labeled rectangles, not "here is your actual yard from above." Acceptable for MVP; uploading + calibrating an aerial image is its own can of worms.*
- *Rectangle-only shapes can't represent curved or irregular plots. Same response as above — we add polygon support later if the limitation bites.*
- *Hand-rolling drag/resize is more code than reaching for Konva.js. The tradeoff is fewer dependencies vs. fewer lines of editor code; for an MVP at this scale, fewer dependencies wins. Konva is a clean swap-in later if the editor's interactions feel rough.*

---

## How to use this going forward

Whenever Claude and I make a non-obvious choice, Claude scaffolds the **Context**, **Options**, and **Decision** sections; I rewrite the *italic hints* in my own words into the **Why** and **Tradeoffs** sections. Goal: by Day 10, every entry is in my voice, and I can riff on any of them for 60 seconds in an interview.
