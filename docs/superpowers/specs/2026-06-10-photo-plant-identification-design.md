# Photo-Based Plant Identification — Design

**Date:** 2026-06-10
**Status:** Approved
**Feature:** Snap/upload a photo while adding a plant; Pl@ntNet identifies the species; the result chains into Perenual for growing data and becomes a first-class species row. The photo is kept and linked to the plant.

This is phase 1 of a three-phase roadmap: photo ID → companion-planting compatibility → AI combination recommendations. Photo ID comes first because it populates `scientific_name` on species, which the later phases need as a stable join key.

---

## 1. Scope

**In scope**

- "Identify from photo" entry point inside the existing add-plant form on the garden detail page.
- Camera capture / file upload, client-side resize, Pl@ntNet identification, top-3 candidate picker UI.
- Species resolution: match existing species or create a new one, enriched via Perenual (this implements the code side of DECISIONS.md Entry #14, which so far exists only as schema).
- Photo persistence in a private Supabase Storage bucket, linked via the existing `plant_photos` table, displayed via signed URLs.

**Out of scope (later phases / follow-ups)**

- Companion compatibility and AI recommendations.
- Identifying/re-identifying an already-placed plant.
- Standalone identify page.
- Growth log (multiple photos over time) — the `plant_photos` table already supports it; UI deferred.
- Supabase Edge Function proxy for API keys (documented upgrade path; not now).

## 2. Architecture decision

**Client-direct API calls.** The browser calls Pl@ntNet's `POST https://my-api.plantnet.org/v2/identify/all?api-key=…` endpoint directly with multipart form data. Pl@ntNet supports CORS from browsers when the calling origin is registered under **Authorized domains** in the developer account (one line per origin; `http://localhost:4200` for dev, the Vercel domain for prod).

The API key lives in `src/environments/environment.ts` (gitignored), consistent with the Perenual key and DECISIONS.md Entry #14's explicit acceptance of client-bundle keys at portfolio scale. The Supabase Edge Function proxy remains the documented hardening step if the app ever gets real traffic.

## 3. User flow

1. In the add-plant form (garden detail page), a **"📷 Identify from photo"** button sits next to the existing name input.
2. Tapping it triggers `<input type="file" accept="image/*" capture="environment">` — phones open the camera, desktops open a file dialog.
3. The image is resized client-side to ≤1600 px on the long edge (canvas API, JPEG ~0.85 quality) before any upload.
4. The app calls Pl@ntNet with `organs=auto` and renders the **top 3 candidates** as cards: common name, scientific name, confidence bar, Pl@ntNet reference thumbnail.
5. The user picks a candidate, or taps **"None of these — type a name instead"** to fall back to the existing free-text + autocomplete path.
6. On confirm:
   a. Species is resolved/created (section 4).
   b. Plant row is inserted via the existing `PlantService.create` with `plantnet_score` set.
   c. The resized photo is uploaded to Storage and a `plant_photos` row (`is_primary = true`) is inserted.
7. The new plant appears in the plant list and on the yard map exactly like a typed-name plant. Its row shows a small photo thumbnail (signed URL).

## 4. Species resolution (Pl@ntNet → Perenual chain)

New method `SpeciesService.ensureByIdentification(candidate)` where `candidate` carries Pl@ntNet's scientific name, common names, and score:

1. **Find:** case-insensitive trimmed match on `scientific_name` OR `common_name` (reuses the existing dual-field `.or()` ILIKE pattern). If found, return it; if the existing row has a NULL `scientific_name`, backfill it from the candidate.
2. **Enrich:** if no match, query Perenual `GET /api/species-list?key=…&q=<scientific name>`. Take the best result (exact scientific-name match preferred, else first result).
3. **Create:** insert the species with:
   - `common_name` = Pl@ntNet's first common name, falling back to the scientific name.
   - `scientific_name` = Pl@ntNet's scientific name (without author).
   - `display_number` = next sequential (existing pattern).
   - When Perenual hit: `external_source = 'perenual'`, `external_id`, `height_ft_min`/`height_ft_max` (converted from Perenual's units), `external_data` = full JSON response.
   - When Perenual missed or failed: `external_source = 'plantnet'`, height columns NULL — color-by-height falls back to the existing "unknown" gray.

`plantnet_score` is stored on the **plant** row (per-photo confidence), not the species.

## 5. Photo storage

- New **private** Supabase Storage bucket `plant-photos`, created by a migration along with storage RLS policies.
- Path convention: `{user_id}/{plant_id}/{uuid}.jpg`. Policies allow users to read/write only objects under their own `user_id` prefix (`storage.foldername(name)[1] = auth.uid()::text`).
- After plant insert, upload the resized JPEG and insert a `plant_photos` row (`storage_path`, `is_primary = true`). The table and its RLS policies already exist — this is their first real use.
- Display via signed URLs (60-minute expiry), fetched on demand by `PhotoService`.
- **Ordering/failure:** the plant insert is the primary action. If photo upload or the `plant_photos` insert fails afterward, the plant survives and the UI shows a non-fatal "photo couldn't be saved" message.

## 6. Components and services

All follow existing project patterns (standalone Angular components, `inject()`, signals, per-component SCSS, services as thin Supabase/HTTP data-access layers, `isPlatformBrowser` guards for browser-only APIs).

| Unit | Responsibility |
|---|---|
| `PlantIdService` (`gardens/plant-id.service.ts`) | Pl@ntNet HTTP call (multipart fetch), response typing, mapping to a `PlantIdCandidate[]` (top 3) |
| `PerenualService` (`gardens/perenual.service.ts`) | `searchByScientificName()`; maps Perenual response → species external columns (incl. unit conversion to feet) |
| `PhotoService` (`gardens/photo.service.ts`) | Canvas resize, Storage upload, `plant_photos` insert, signed-URL fetch |
| `SpeciesService.ensureByIdentification()` | The find/enrich/create chain in section 4 |
| `IdentifyPlantComponent` (`gardens/identify-plant/`) | Capture button, loading state, candidate cards, fallback link; emits the chosen candidate + photo blob to the parent |
| `garden-detail` changes | Hosts `IdentifyPlantComponent` in the add-plant form; orchestrates confirm flow (species → plant → photo); renders photo thumbnails |
| Migration `2026…_plant_photos_bucket.sql` | Creates the `plant-photos` bucket + storage policies |

## 7. Error handling

| Failure | Behavior |
|---|---|
| Pl@ntNet 4xx/5xx, network error, daily quota (500/day) exhausted | Toast with reason; user falls back to typing a name. The text path is never blocked. |
| Pl@ntNet returns zero results | "Couldn't identify this photo" message + fallback to typing. |
| Top score < 0.10 | Candidates still shown, with a "low confidence" caveat on the cards. |
| Perenual down / no match | Species created from Pl@ntNet data alone (`external_source = 'plantnet'`); no user-facing error. |
| Photo upload fails after plant created | Plant kept; non-fatal toast. |
| SSR | All camera/canvas/fetch-with-File code guarded with `isPlatformBrowser`, matching the existing Supabase guard pattern. |

## 8. Testing

- **Unit (Vitest/Karma, mocked fetch + Supabase):** Pl@ntNet response → candidate mapping (incl. empty results, missing common names); Perenual response → species-column mapping (unit conversion, no-match); `ensureByIdentification` find/backfill/create branches; resize dimension math.
- **Component:** `IdentifyPlantComponent` states — idle, loading, candidates, error, fallback link.
- **Manual:** camera capture on a real phone (the `capture="environment"` path can't be exercised in unit tests); end-to-end add-via-photo on localhost against real APIs.

## 9. Owner setup checklist (manual, one-time)

1. Create a Pl@ntNet account at my.plantnet.org; put the API key in `environment.ts` (and Vercel env for CI builds).
2. Add `http://localhost:4200` and the production Vercel domain under **Authorized domains** in the Pl@ntNet account.
3. **Rotate the Perenual API key** currently committed in `environment.example.ts` and replace it with a placeholder string.

## 10. Future hooks

- Species rows gain `scientific_name` + `external_data` through this flow — the join keys phase 2 (companion compatibility) and phase 3 (AI recommendations) will consume.
- `plant_photos` supports multiple rows per plant → growth-log feature later.
- Swapping client-direct calls for a Supabase Edge Function proxy touches only `PlantIdService`/`PerenualService` internals; component contracts unchanged.
