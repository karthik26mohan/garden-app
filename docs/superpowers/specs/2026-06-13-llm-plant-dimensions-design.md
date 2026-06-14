# Claude-Powered Plant Dimension Lookup — Design

**Date:** 2026-06-13
**Status:** Approved
**Feature:** When a new species is created from a photo identification, look up its typical mature height and canopy spread via Claude (Haiku 4.5) behind a Supabase Edge Function, store both on the species, and seed the plant's on-map diameter from the spread.

This closes a gap found while testing photo identification: the plant's `diameter_ft` was never derived from any data source — it defaulted to 1 ft for every photo-identified plant. Perenual's `species/details` endpoint (the only place its dimensions live) is premium-only, so neither height nor spread is available on the free tier. Claude fills that gap. This also implements the LLM-fallback path that DECISIONS.md Entry #14 always planned, and pre-builds the Claude integration that the roadmap's phase 3 (AI recommendations) will reuse.

---

## 1. Scope

**In scope**

- A Supabase Edge Function (`plant-dimensions`) that proxies a single Claude Haiku 4.5 structured-output call. The Anthropic API key lives in Supabase secrets, never in the client bundle.
- An Angular `PlantDimensionService` that invokes the function via supabase-js.
- A migration adding `spread_ft_min`, `spread_ft_max`, and `dimensions_source` columns to `species`.
- Wiring the lookup into `SpeciesService.ensureByIdentification` for **new species only**.
- Seeding `diameter_ft` from the species' `spread_ft_max` when persisting a photo-identified plant.

**Out of scope (YAGNI / later)**

- Backfilling dimensions onto species that already exist (same stance as the existing scientific-name backfill — new species only).
- Dimension lookup for the typed-name add flow (`ensureByName`) — it has no guaranteed scientific name.
- A "re-estimate dimensions" or manual-override UI for species.
- Watering/sunlight/hardiness via LLM (height + spread only).

## 2. Architecture decision

**Supabase Edge Function proxy** (not client-direct). An Anthropic API key is billing-capable across every model, a materially higher exposure than the quota-capped Pl@ntNet/Perenual keys. The key stays server-side in Supabase secrets; the browser only ever talks to the function. This is the "real backend" hardening step the DECISIONS log repeatedly named as the eventual fix — done here because the key's risk profile justifies it now.

```
browser → supabase.functions.invoke('plant-dimensions', { scientificName, commonName })
        → Edge Function (Deno; reads ANTHROPIC_API_KEY from env/secrets)
        → Anthropic Messages API (claude-haiku-4-5, structured output)
        → { heightFtMin, heightFtMax, spreadFtMin, spreadFtMax }   (each field number | null)
```

The function relies on Supabase's default `verify_jwt = true`: supabase-js attaches the signed-in user's JWT to `functions.invoke`, so only authenticated users can reach the proxy. Unauthenticated calls are rejected by the platform before the function runs.

## 3. Edge Function: `supabase/functions/plant-dimensions/`

- **Runtime:** Deno 2 (project's configured edge runtime).
- **Request body:** `{ scientificName: string, commonName?: string }`.
- **Model call:** `claude-haiku-4-5`, `max_tokens` ~256, no thinking (Haiku has none), structured output via `output_config.format` (`json_schema`). Prompt asks for typical mature height and canopy spread in **feet**, with explicit instruction to return `null` for any unknown field rather than guessing.
- **Output schema** (all fields `["number", "null"]`): `heightFtMin`, `heightFtMax`, `spreadFtMin`, `spreadFtMax`.
- **Response:** the parsed dimensions object as JSON. On any upstream failure (missing key, Anthropic error, unparseable body) the function returns all-nulls with HTTP 200 — dimensions are best-effort, exactly like a Perenual miss, so the caller never has to special-case errors.
- **Testability:** the Anthropic-response → dimensions mapping is a pure exported function (`parseDimensions`) covered by a Deno test; the HTTP handler around it stays thin.
- **CORS:** return permissive CORS headers (and handle the `OPTIONS` preflight) so the browser can invoke it; `functions.invoke` issues a cross-origin request from the app.

## 4. Data model — migration

`supabase/migrations/2026…_species_dimensions.sql` adds to `public.species`:

```sql
alter table public.species
  add column spread_ft_min    numeric,
  add column spread_ft_max    numeric,
  add column dimensions_source text;   -- 'perenual' | 'llm' | null
```

Height columns (`height_ft_min`, `height_ft_max`) already exist (migration `20260531000001`). `dimensions_source` records where the **dimensions** came from, distinct from `external_source` (which records the catalog match). This keeps AI-estimated dimensions honestly distinguishable from catalog data.

## 5. Integration into `ensureByIdentification`

Only the **create new species** branch changes (the find/backfill branch returns early, unchanged):

1. Perenual lookup runs as today (gives `external_id` + catalog `raw`; height is null on the free tier).
2. Call `PlantDimensionService.lookup(scientificName, commonName)`.
3. Merge dimensions with **Perenual taking precedence** when it has a value (a future paid tier would then win), else LLM:
   - `height_ft_min/max` = Perenual height if present, else LLM height.
   - `spread_ft_min/max` = LLM spread (Perenual free tier has none).
   - `dimensions_source` = `'perenual'` if any Perenual dimension was used, else `'llm'` if any LLM dimension was used, else `null`.
4. Insert the species with the merged dimension columns added to the existing payload.

The dimension lookup is best-effort: if it throws or returns all-nulls, the species is still created (dims null, `dimensions_source` null) — same degradation as a Perenual miss. The existing `23505` unique-violation re-read path is unaffected.

## 6. Diameter seeding

In `garden-detail.onIdentified`, after `ensureByIdentification` returns the species, seed the new plant's diameter from the species' mature canopy width:

```
diameter_ft = species.spread_ft_max ?? this.newPlantDiameter()
```

`spread_ft_max` is the right number: the on-map circle represents the plant's footprint/spacing, so planning for full mature spread is correct. When spread is unknown, fall back to the manual diameter field (default 1) — unchanged behavior for that case. The typed-name `onAddPlant` flow is untouched.

## 7. Components and services

| Unit | Responsibility |
|---|---|
| `supabase/functions/plant-dimensions/index.ts` | HTTP handler: CORS/preflight, parse body, call Anthropic, return dimensions (all-null on failure) |
| `parseDimensions` (in the function, exported) | Pure: Anthropic response JSON → `{heightFtMin, heightFtMax, spreadFtMin, spreadFtMax}`, null-tolerant |
| `PlantDimensionService` (`gardens/plant-dimension.service.ts`) | `lookup(scientificName, commonName?)` → dimensions or all-nulls; wraps `supabase.functions.invoke`, swallows errors to nulls |
| `SpeciesService.ensureByIdentification` | Adds the lookup + merge into the create branch |
| `Species` interface | Gains `spread_ft_min`, `spread_ft_max`, `dimensions_source` |
| `garden-detail.onIdentified` | Seeds `diameter_ft` from `spread_ft_max` |
| Migration | Adds the three columns |

## 8. Error handling

| Failure | Behavior |
|---|---|
| Anthropic key missing / Anthropic 4xx-5xx / malformed body | Function returns all-nulls (HTTP 200); species created without dimensions; no user-facing error |
| `functions.invoke` network error | `PlantDimensionService.lookup` catches → returns all-nulls; species still created |
| LLM returns nulls for an unknown plant | Stored as null dims; diameter falls back to the manual field |
| Function not yet deployed (dev before setup) | `invoke` errors → caught → all-nulls; photo-add still works, plants just get default diameter |

## 9. Testing

- **`PlantDimensionService` (Vitest, mocked `supabase.functions.invoke`):** success maps to dimensions; invoke error → all-nulls; partial-null payload preserved.
- **`parseDimensions` (Deno test):** valid full JSON; partial nulls; malformed/missing fields → nulls.
- **`ensureByIdentification` (extend existing Vitest spec):** new species with LLM dims; Perenual-height-precedence over LLM; `dimensions_source` set correctly; existing-species find still skips the lookup; lookup failure still creates the species.
- **`garden-detail` integration:** verified by the existing suite staying green plus `npm run build`; diameter-seeding logic is a one-liner exercised in manual testing (Task: manual checklist).

## 10. Owner setup (one-time, manual)

1. Get an Anthropic API key (console.anthropic.com) with billing enabled.
2. `supabase secrets set ANTHROPIC_API_KEY=sk-ant-…`
3. `supabase functions deploy plant-dimensions`
4. (Local dev) `supabase functions serve` with the key in `supabase/functions/.env` (gitignored).

## 11. Future hooks

- The Edge Function establishes the Claude integration; phase 3 (AI plant-combination recommendations) reuses the same proxy pattern and key.
- `dimensions_source = 'llm'` rows can later be upgraded in place if a paid Perenual tier or a manual-override UI is added.
- Height (`height_ft_min/max`) now actually gets populated, unblocking the previously-dark color-by-height visualization.
