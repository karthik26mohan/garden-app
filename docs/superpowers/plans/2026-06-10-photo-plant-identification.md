# Photo-Based Plant Identification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the garden-detail add-plant form, the user can snap/upload a photo, get top-3 Pl@ntNet species candidates, confirm one, and the app creates the species (enriched via Perenual), inserts the plant, and stores the photo in Supabase Storage.

**Architecture:** Client-direct API calls (browser → Pl@ntNet and browser → Perenual), per the approved spec (`docs/superpowers/specs/2026-06-10-photo-plant-identification-design.md`) and DECISIONS.md Entry #14. Three new thin services (`PlantIdService`, `PerenualService`, `PhotoService`) with their mapping logic as exported pure functions so they're testable without DI. One new standalone component (`IdentifyPlantComponent`) embedded in garden-detail. One SQL migration for the private `plant-photos` Storage bucket.

**Tech Stack:** Angular 21 (standalone components, signals, `inject()`), Supabase JS v2 (DB + Storage), Vitest via `ng test` (`@angular/build:unit-test` builder, jsdom), Pl@ntNet API v2, Perenual API.

**Conventions to follow (read before starting):**
- Services live in `src/app/gardens/`, are `@Injectable({ providedIn: 'root' })`, use `inject(SupabaseService)`, throw raw Supabase errors. Model: `src/app/gardens/species.service.ts`.
- Components are standalone, signal-based, with sibling `.html`/`.scss`. Model: `src/app/gardens/garden-detail/`.
- Browser-only code is guarded with `isPlatformBrowser(inject(PLATFORM_ID))`.
- Tests are colocated `*.spec.ts`, run with `npm test -- --watch=false`. Vitest globals (`describe`/`it`/`expect`/`vi`) are available.
- Commit after every green test cycle. Work on a feature branch.

---

### Task 0: Branch + sanity check

**Files:** none

- [ ] **Step 0.1: Create a feature branch and verify the test suite runs**

```bash
cd "/Users/kmohan/Documents/Claude/Projects/garden app/garden-app"
git checkout -b feature/photo-plant-id
npm test -- --watch=false
```

Expected: existing `app.spec.ts` tests PASS (2 tests). If `npm test` fails for environment reasons (e.g. missing `environment.ts`), stop and resolve before continuing.

- [ ] **Step 0.2: Verify `environment.ts` has a `plantnet` block**

Open `src/environments/environment.ts` (gitignored). It must contain, alongside the existing `supabase` and `perenual` blocks:

```ts
  plantnet: {
    apiKey: 'THE-REAL-KEY-FROM-MY.PLANTNET.ORG',
  },
```

If the key isn't available yet, use a placeholder string — all tests mock fetch, so nothing calls the real API until manual testing (Task 10).

---

### Task 1: Pl@ntNet response mapping (pure function + types)

**Files:**
- Create: `src/app/gardens/plant-id.service.ts`
- Test: `src/app/gardens/plant-id.service.spec.ts`

- [ ] **Step 1.1: Write the failing tests**

Create `src/app/gardens/plant-id.service.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mapPlantNetResponse, PlantIdCandidate } from './plant-id.service';

/** A realistic trimmed Pl@ntNet /v2/identify response. */
const PLANTNET_RESPONSE = {
  results: [
    {
      score: 0.8721,
      species: {
        scientificNameWithoutAuthor: 'Lavandula angustifolia',
        commonNames: ['English lavender', 'True lavender'],
      },
      images: [{ url: { m: 'https://bs.plantnet.org/image/m/abc123' } }],
    },
    {
      score: 0.0512,
      species: {
        scientificNameWithoutAuthor: 'Lavandula stoechas',
        commonNames: [],
      },
      images: [],
    },
    {
      score: 0.0211,
      species: {
        scientificNameWithoutAuthor: 'Salvia officinalis',
        commonNames: ['Sage'],
      },
    },
    {
      score: 0.0099,
      species: {
        scientificNameWithoutAuthor: 'Rosmarinus officinalis',
        commonNames: ['Rosemary'],
      },
    },
  ],
};

describe('mapPlantNetResponse', () => {
  it('maps results to candidates, capped at top 3', () => {
    const candidates = mapPlantNetResponse(PLANTNET_RESPONSE);
    expect(candidates).toHaveLength(3);
    expect(candidates[0]).toEqual<PlantIdCandidate>({
      scientificName: 'Lavandula angustifolia',
      commonNames: ['English lavender', 'True lavender'],
      score: 0.8721,
      thumbnailUrl: 'https://bs.plantnet.org/image/m/abc123',
    });
  });

  it('uses null thumbnail when images are missing or empty', () => {
    const candidates = mapPlantNetResponse(PLANTNET_RESPONSE);
    expect(candidates[1].thumbnailUrl).toBeNull(); // empty images array
    expect(candidates[2].thumbnailUrl).toBeNull(); // no images key
  });

  it('returns [] for an empty or malformed response', () => {
    expect(mapPlantNetResponse({ results: [] })).toEqual([]);
    expect(mapPlantNetResponse({})).toEqual([]);
    expect(mapPlantNetResponse(null)).toEqual([]);
  });
});
```

- [ ] **Step 1.2: Run tests to verify they fail**

Run: `npm test -- --watch=false`
Expected: FAIL — `plant-id.service` module not found.

- [ ] **Step 1.3: Write the implementation**

Create `src/app/gardens/plant-id.service.ts`:

```ts
import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

/**
 * One species candidate from a Pl@ntNet identification, in app shape.
 * The raw API response is mapped through mapPlantNetResponse() so the
 * rest of the app never touches Pl@ntNet's nested JSON.
 */
export interface PlantIdCandidate {
  scientificName: string;
  commonNames: string[];
  /** Pl@ntNet confidence, 0..1. Stored on the plant row as plantnet_score. */
  score: number;
  /** Medium-size reference image of the candidate species, if provided. */
  thumbnailUrl: string | null;
}

/** Thrown when Pl@ntNet returns a non-OK status, with a user-facing message. */
export class PlantIdError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const IDENTIFY_URL = 'https://my-api.plantnet.org/v2/identify/all';
const MAX_CANDIDATES = 3;

/**
 * Map a raw Pl@ntNet /v2/identify response to the top candidates.
 * Pure function, exported for testing. Defensive about shape: any
 * missing/malformed pieces produce an empty array rather than a throw,
 * because a "we couldn't identify this" UI state is the desired
 * behavior for all garbage-in cases.
 */
export function mapPlantNetResponse(json: unknown): PlantIdCandidate[] {
  const results = (json as { results?: unknown[] } | null)?.results;
  if (!Array.isArray(results)) return [];

  return results.slice(0, MAX_CANDIDATES).flatMap((r) => {
    const result = r as {
      score?: number;
      species?: {
        scientificNameWithoutAuthor?: string;
        commonNames?: string[];
      };
      images?: { url?: { m?: string } }[];
    };
    const scientificName = result.species?.scientificNameWithoutAuthor;
    if (!scientificName || typeof result.score !== 'number') return [];

    return [
      {
        scientificName,
        commonNames: result.species?.commonNames ?? [],
        score: result.score,
        thumbnailUrl: result.images?.[0]?.url?.m ?? null,
      },
    ];
  });
}

/**
 * Calls Pl@ntNet's identification API directly from the browser.
 *
 * Client-direct architecture per the spec: the API key ships in the
 * bundle (same accepted tradeoff as the Perenual key, DECISIONS.md
 * Entry #14) and the app's origins must be registered under
 * "Authorized domains" in the Pl@ntNet account for CORS to pass.
 */
@Injectable({ providedIn: 'root' })
export class PlantIdService {
  /**
   * Identify a plant photo. Returns the top 3 candidates, possibly
   * empty (= "couldn't identify"). Throws PlantIdError on HTTP errors
   * so the UI can show a reason and fall back to typed names.
   */
  async identify(photo: Blob): Promise<PlantIdCandidate[]> {
    const form = new FormData();
    form.append('images', photo, 'photo.jpg');
    form.append('organs', 'auto');

    const url = `${IDENTIFY_URL}?api-key=${encodeURIComponent(environment.plantnet.apiKey)}`;
    const res = await fetch(url, { method: 'POST', body: form });

    if (!res.ok) {
      // 404 = "species not found" for identify — treat as no candidates.
      if (res.status === 404) return [];
      const message =
        res.status === 429
          ? 'Daily identification limit reached — try again tomorrow, or type the name.'
          : `Plant identification failed (HTTP ${res.status}).`;
      throw new PlantIdError(message, res.status);
    }

    return mapPlantNetResponse(await res.json());
  }
}
```

- [ ] **Step 1.4: Run tests to verify they pass**

Run: `npm test -- --watch=false`
Expected: PASS (all suites).

- [ ] **Step 1.5: Commit**

```bash
git add src/app/gardens/plant-id.service.ts src/app/gardens/plant-id.service.spec.ts
git commit -m "feat: add Pl@ntNet identification service with response mapping"
```

---

### Task 2: PlantIdService.identify() fetch behavior

**Files:**
- Modify: `src/app/gardens/plant-id.service.spec.ts` (append tests)

The implementation already exists (Task 1 Step 1.3); this task locks down the HTTP behavior with mocked `fetch`.

- [ ] **Step 2.1: Write the failing tests**

Append to `src/app/gardens/plant-id.service.spec.ts`:

```ts
import { afterEach, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PlantIdError, PlantIdService } from './plant-id.service';

describe('PlantIdService.identify', () => {
  let service: PlantIdService;
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    TestBed.configureTestingModule({});
    service = TestBed.inject(PlantIdService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs multipart form data with organs=auto and returns candidates', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(PLANTNET_RESPONSE), { status: 200 }),
    );

    const candidates = await service.identify(new Blob(['x']));

    expect(candidates).toHaveLength(3);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('my-api.plantnet.org/v2/identify/all');
    expect(String(url)).toContain('api-key=');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('organs')).toBe('auto');
    expect((init.body as FormData).get('images')).toBeInstanceOf(Blob);
  });

  it('returns [] on 404 (species not found)', async () => {
    fetchMock.mockResolvedValue(new Response('not found', { status: 404 }));
    await expect(service.identify(new Blob(['x']))).resolves.toEqual([]);
  });

  it('throws a quota message on 429', async () => {
    fetchMock.mockResolvedValue(new Response('slow down', { status: 429 }));
    await expect(service.identify(new Blob(['x']))).rejects.toMatchObject({
      status: 429,
      message: expect.stringContaining('limit'),
    });
    await expect(service.identify(new Blob(['x']))).rejects.toBeInstanceOf(
      PlantIdError,
    );
  });

  it('throws PlantIdError with status on other HTTP errors', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    await expect(service.identify(new Blob(['x']))).rejects.toMatchObject({
      status: 500,
    });
  });
});
```

Note: `PLANTNET_RESPONSE` is the const defined at the top of this spec file in Task 1.

- [ ] **Step 2.2: Run tests**

Run: `npm test -- --watch=false`
Expected: PASS (implementation from Task 1 already covers this). If any test fails, fix the service — the tests are the contract.

- [ ] **Step 2.3: Commit**

```bash
git add src/app/gardens/plant-id.service.spec.ts
git commit -m "test: cover PlantIdService HTTP behavior with mocked fetch"
```

---

### Task 3: Perenual lookup service (search + details + height mapping)

**Files:**
- Create: `src/app/gardens/perenual.service.ts`
- Test: `src/app/gardens/perenual.service.spec.ts`

Perenual's flow needs two calls: `GET /api/species-list?key=…&q=<name>` to find the species id, then `GET /api/species/details/{id}?key=…` for dimension data. Height appears either as a `dimensions` array (`[{ type: 'Height', min_value, max_value, unit }]`) or a legacy `dimension` string (`"3-6 feet"`); the mapper handles both, converting meters → feet when needed.

- [ ] **Step 3.1: Write the failing tests**

Create `src/app/gardens/perenual.service.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  extractHeightFt,
  PerenualService,
  pickBestMatch,
} from './perenual.service';

describe('pickBestMatch', () => {
  const items = [
    { id: 1, common_name: 'Lavender hybrid', scientific_name: ['Lavandula x intermedia'] },
    { id: 2, common_name: 'English lavender', scientific_name: ['Lavandula angustifolia'] },
  ];

  it('prefers an exact scientific-name match (case-insensitive)', () => {
    expect(pickBestMatch(items, 'lavandula ANGUSTIFOLIA')?.id).toBe(2);
  });

  it('falls back to the first result when nothing matches exactly', () => {
    expect(pickBestMatch(items, 'Lavandula somethingelse')?.id).toBe(1);
  });

  it('returns null for an empty list', () => {
    expect(pickBestMatch([], 'Lavandula angustifolia')).toBeNull();
  });
});

describe('extractHeightFt', () => {
  it('reads a dimensions array in feet', () => {
    const details = {
      dimensions: [{ type: 'Height', min_value: 1, max_value: 3, unit: 'feet' }],
    };
    expect(extractHeightFt(details)).toEqual({ min: 1, max: 3 });
  });

  it('converts meters to feet (2 decimal places)', () => {
    const details = {
      dimensions: [{ type: 'Height', min_value: 1, max_value: 2, unit: 'meters' }],
    };
    expect(extractHeightFt(details)).toEqual({ min: 3.28, max: 6.56 });
  });

  it('parses a legacy dimension string like "3-6 feet"', () => {
    expect(extractHeightFt({ dimension: '3-6 feet' })).toEqual({ min: 3, max: 6 });
  });

  it('returns nulls when no height data exists', () => {
    expect(extractHeightFt({})).toEqual({ min: null, max: null });
    expect(extractHeightFt({ dimensions: [] })).toEqual({ min: null, max: null });
    expect(extractHeightFt({ dimension: 'tall-ish' })).toEqual({ min: null, max: null });
  });
});

describe('PerenualService.searchByScientificName', () => {
  let service: PerenualService;
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    TestBed.configureTestingModule({});
    service = TestBed.inject(PerenualService);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('searches, picks the best match, fetches details, returns mapped data', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { id: 2, common_name: 'English lavender', scientific_name: ['Lavandula angustifolia'] },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 2,
            dimensions: [{ type: 'Height', min_value: 1, max_value: 3, unit: 'feet' }],
            watering: 'Average',
          }),
          { status: 200 },
        ),
      );

    const result = await service.searchByScientificName('Lavandula angustifolia');

    expect(result).not.toBeNull();
    expect(result!.externalId).toBe('2');
    expect(result!.heightFtMin).toBe(1);
    expect(result!.heightFtMax).toBe(3);
    expect(result!.raw).toMatchObject({ watering: 'Average' });
    expect(String(fetchMock.mock.calls[0][0])).toContain('species-list');
    expect(String(fetchMock.mock.calls[1][0])).toContain('species/details/2');
  });

  it('returns null when the search has no results', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    await expect(service.searchByScientificName('Nonexistus plantus')).resolves.toBeNull();
  });

  it('returns null (not throw) on HTTP errors — Perenual is best-effort', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }));
    await expect(service.searchByScientificName('Lavandula angustifolia')).resolves.toBeNull();
  });

  it('still returns search-derived data when the details call fails', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ id: 2, scientific_name: ['Lavandula angustifolia'] }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response('nope', { status: 500 }));

    const result = await service.searchByScientificName('Lavandula angustifolia');
    expect(result).toEqual({
      externalId: '2',
      heightFtMin: null,
      heightFtMax: null,
      raw: { id: 2, scientific_name: ['Lavandula angustifolia'] },
    });
  });
});
```

- [ ] **Step 3.2: Run tests to verify they fail**

Run: `npm test -- --watch=false`
Expected: FAIL — `perenual.service` module not found.

- [ ] **Step 3.3: Write the implementation**

Create `src/app/gardens/perenual.service.ts`:

```ts
import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

/**
 * Perenual data mapped to the species table's external columns.
 * See supabase/migrations/20260531000001_species_external_cache.sql
 * and DECISIONS.md Entry #14.
 */
export interface PerenualSpeciesData {
  externalId: string;
  heightFtMin: number | null;
  heightFtMax: number | null;
  /** Full API response, cached into species.external_data (jsonb). */
  raw: unknown;
}

interface PerenualListItem {
  id: number;
  common_name?: string;
  scientific_name?: string[];
}

const BASE_URL = 'https://perenual.com/api';
const METERS_TO_FEET = 3.28084;

/**
 * Pick the search result whose scientific_name matches exactly
 * (case-insensitive); otherwise the first result; null if empty.
 * Pure function, exported for testing.
 */
export function pickBestMatch(
  items: PerenualListItem[],
  scientificName: string,
): PerenualListItem | null {
  if (!items.length) return null;
  const wanted = scientificName.trim().toLowerCase();
  const exact = items.find((item) =>
    (item.scientific_name ?? []).some((n) => n.trim().toLowerCase() === wanted),
  );
  return exact ?? items[0];
}

/**
 * Extract min/max mature height in feet from a Perenual details response.
 * Handles both the structured `dimensions` array and the legacy
 * `dimension` string ("3-6 feet"). Pure function, exported for testing.
 */
export function extractHeightFt(details: unknown): {
  min: number | null;
  max: number | null;
} {
  const d = details as {
    dimensions?: { type?: string; min_value?: number; max_value?: number; unit?: string }[];
    dimension?: string;
  } | null;

  const height = d?.dimensions?.find((dim) => dim.type?.toLowerCase() === 'height');
  if (height && typeof height.min_value === 'number' && typeof height.max_value === 'number') {
    const factor = height.unit?.toLowerCase().startsWith('m') ? METERS_TO_FEET : 1;
    const round = (n: number) => Math.round(n * factor * 100) / 100;
    return { min: round(height.min_value), max: round(height.max_value) };
  }

  const text = d?.dimension;
  const match = text?.match(/([\d.]+)\s*-\s*([\d.]+)\s*feet/i);
  if (match) {
    return { min: parseFloat(match[1]), max: parseFloat(match[2]) };
  }

  return { min: null, max: null };
}

/**
 * Best-effort lookup against the Perenual plant database. Every public
 * method resolves to null on failure instead of throwing: Perenual
 * enrichment is a bonus, never a blocker, per the spec's error-handling
 * table. (Same client-side-key tradeoff as DECISIONS.md Entry #14.)
 */
@Injectable({ providedIn: 'root' })
export class PerenualService {
  /**
   * Search Perenual by scientific name and fetch growing details for
   * the best match. Two API calls (one species-list, one details).
   */
  async searchByScientificName(
    scientificName: string,
  ): Promise<PerenualSpeciesData | null> {
    const key = encodeURIComponent(environment.perenual.apiKey);

    try {
      const searchRes = await fetch(
        `${BASE_URL}/species-list?key=${key}&q=${encodeURIComponent(scientificName)}`,
      );
      if (!searchRes.ok) return null;

      const searchJson = (await searchRes.json()) as { data?: PerenualListItem[] };
      const best = pickBestMatch(searchJson.data ?? [], scientificName);
      if (!best) return null;

      // Details call enriches with height; if it fails we still return
      // the id + search payload so the species records its external link.
      const detailsRes = await fetch(`${BASE_URL}/species/details/${best.id}?key=${key}`);
      if (!detailsRes.ok) {
        return {
          externalId: String(best.id),
          heightFtMin: null,
          heightFtMax: null,
          raw: best,
        };
      }

      const details = await detailsRes.json();
      const height = extractHeightFt(details);
      return {
        externalId: String(best.id),
        heightFtMin: height.min,
        heightFtMax: height.max,
        raw: details,
      };
    } catch {
      return null; // network failure → best-effort null
    }
  }
}
```

- [ ] **Step 3.4: Run tests to verify they pass**

Run: `npm test -- --watch=false`
Expected: PASS.

- [ ] **Step 3.5: Commit**

```bash
git add src/app/gardens/perenual.service.ts src/app/gardens/perenual.service.spec.ts
git commit -m "feat: add Perenual lookup service with height extraction"
```

---

### Task 4: Storage bucket migration

**Files:**
- Create: `supabase/migrations/20260610000001_plant_photos_bucket.sql`

- [ ] **Step 4.1: Write the migration**

Create `supabase/migrations/20260610000001_plant_photos_bucket.sql`:

```sql
-- Private Storage bucket for plant photos, per the photo-identification
-- spec (docs/superpowers/specs/2026-06-10-photo-plant-identification-design.md).
--
-- Path convention: {user_id}/{plant_id}/{uuid}.jpg
-- Policies key off the FIRST path segment matching auth.uid(), so a user
-- can only touch objects under their own folder. The plant_photos table
-- (migration 20260516000004) stores the path; signed URLs are issued at
-- read time by the app.

insert into storage.buckets (id, name, public)
values ('plant-photos', 'plant-photos', false)
on conflict (id) do nothing;

create policy "plant_photos_storage_select_own"
  on storage.objects for select
  using (
    bucket_id = 'plant-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "plant_photos_storage_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'plant-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "plant_photos_storage_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'plant-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

(No update policy: photos are immutable — replace = delete + insert.)

- [ ] **Step 4.2: Apply the migration**

Run: `cd "/Users/kmohan/Documents/Claude/Projects/garden app/garden-app" && npx supabase db push`
Expected: migration `20260610000001` applied without error. If the CLI isn't linked/authenticated in this environment, flag it to the user — they apply it via their usual flow — and continue; nothing before Task 9's manual test needs the live bucket.

- [ ] **Step 4.3: Commit**

```bash
git add supabase/migrations/20260610000001_plant_photos_bucket.sql
git commit -m "feat: add private plant-photos storage bucket with per-user policies"
```

---

### Task 5: PhotoService (resize + upload + signed URLs)

**Files:**
- Create: `src/app/gardens/photo.service.ts`
- Test: `src/app/gardens/photo.service.spec.ts`

- [ ] **Step 5.1: Write the failing tests**

Create `src/app/gardens/photo.service.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PhotoService, scaledDimensions } from './photo.service';
import { SupabaseService } from '../supabase.service';

describe('scaledDimensions', () => {
  it('scales the long edge down to max, preserving aspect ratio', () => {
    expect(scaledDimensions(3200, 2400, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(scaledDimensions(2400, 3200, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it('never upscales smaller images', () => {
    expect(scaledDimensions(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it('rounds to whole pixels', () => {
    expect(scaledDimensions(3001, 2000, 1600)).toEqual({ width: 1600, height: 1066 });
  });
});

describe('PhotoService', () => {
  let service: PhotoService;

  // Chainable mock of the slice of SupabaseClient that PhotoService uses.
  const uploadMock = vi.fn();
  const createSignedUrlsMock = vi.fn();
  const insertMock = vi.fn();
  const inMock = vi.fn();
  const supabaseMock = {
    client: {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      },
      storage: {
        from: vi.fn(() => ({
          upload: uploadMock,
          createSignedUrls: createSignedUrlsMock,
        })),
      },
      from: vi.fn(() => ({
        insert: insertMock,
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ in: inMock })),
        })),
      })),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMock.client.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    });
    TestBed.configureTestingModule({
      providers: [{ provide: SupabaseService, useValue: supabaseMock }],
    });
    service = TestBed.inject(PhotoService);
  });

  describe('uploadPlantPhoto', () => {
    it('uploads under the user/plant path and inserts a primary plant_photos row', async () => {
      uploadMock.mockResolvedValue({ data: { path: 'x' }, error: null });
      insertMock.mockResolvedValue({ error: null });

      await service.uploadPlantPhoto('plant-9', new Blob(['img']));

      const [path, blob, opts] = uploadMock.mock.calls[0];
      expect(path).toMatch(/^user-1\/plant-9\/[0-9a-f-]+\.jpg$/);
      expect(blob).toBeInstanceOf(Blob);
      expect(opts).toMatchObject({ contentType: 'image/jpeg' });
      expect(insertMock).toHaveBeenCalledWith({
        plant_id: 'plant-9',
        storage_path: path,
        is_primary: true,
      });
    });

    it('throws when the storage upload fails', async () => {
      uploadMock.mockResolvedValue({ data: null, error: new Error('storage down') });
      await expect(
        service.uploadPlantPhoto('plant-9', new Blob(['img'])),
      ).rejects.toThrow('storage down');
      expect(insertMock).not.toHaveBeenCalled();
    });

    it('throws when not signed in', async () => {
      supabaseMock.client.auth.getUser.mockResolvedValue({ data: { user: null } });
      await expect(
        service.uploadPlantPhoto('plant-9', new Blob(['img'])),
      ).rejects.toThrow('Not signed in.');
    });
  });

  describe('getPrimaryPhotoUrls', () => {
    it('returns a plant_id → signed URL map', async () => {
      inMock.mockResolvedValue({
        data: [
          { plant_id: 'p1', storage_path: 'user-1/p1/a.jpg' },
          { plant_id: 'p2', storage_path: 'user-1/p2/b.jpg' },
        ],
        error: null,
      });
      createSignedUrlsMock.mockResolvedValue({
        data: [
          { path: 'user-1/p1/a.jpg', signedUrl: 'https://signed/a' },
          { path: 'user-1/p2/b.jpg', signedUrl: 'https://signed/b' },
        ],
        error: null,
      });

      const map = await service.getPrimaryPhotoUrls(['p1', 'p2']);
      expect(map).toEqual({ p1: 'https://signed/a', p2: 'https://signed/b' });
    });

    it('returns {} for an empty input without calling Supabase', async () => {
      await expect(service.getPrimaryPhotoUrls([])).resolves.toEqual({});
      expect(inMock).not.toHaveBeenCalled();
    });

    it('returns {} when the photo query errors (thumbnails are best-effort)', async () => {
      inMock.mockResolvedValue({ data: null, error: new Error('rls says no') });
      await expect(service.getPrimaryPhotoUrls(['p1'])).resolves.toEqual({});
    });
  });
});
```

- [ ] **Step 5.2: Run tests to verify they fail**

Run: `npm test -- --watch=false`
Expected: FAIL — `photo.service` module not found.

- [ ] **Step 5.3: Write the implementation**

Create `src/app/gardens/photo.service.ts`:

```ts
import { inject, Injectable } from '@angular/core';
import { SupabaseService } from '../supabase.service';

const BUCKET = 'plant-photos';
const MAX_EDGE_PX = 1600;
const JPEG_QUALITY = 0.85;
const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * Compute target dimensions for a resize: long edge capped at maxEdge,
 * aspect ratio preserved, never upscaled. Pure function, exported for
 * testing (the canvas plumbing around it can't run in jsdom).
 */
export function scaledDimensions(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) return { width, height };
  const scale = maxEdge / longEdge;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

/**
 * Photo handling: client-side resize, Storage upload, plant_photos rows,
 * signed display URLs.
 *
 * Storage layout: {user_id}/{plant_id}/{uuid}.jpg in the private
 * 'plant-photos' bucket. The user_id prefix is what the storage RLS
 * policies key on (migration 20260610000001).
 *
 * Browser-only (canvas, createImageBitmap): callers are components that
 * already run behind isPlatformBrowser guards.
 */
@Injectable({ providedIn: 'root' })
export class PhotoService {
  private supabase = inject(SupabaseService);

  /**
   * Downscale an image to ≤1600px on the long edge, re-encoded as JPEG.
   * Keeps uploads fast and stays far inside Pl@ntNet's size limits.
   */
  async resizeImage(file: Blob): Promise<Blob> {
    const bitmap = await createImageBitmap(file);
    try {
      const { width, height } = scaledDimensions(
        bitmap.width,
        bitmap.height,
        MAX_EDGE_PX,
      );
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);

      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) =>
            blob ? resolve(blob) : reject(new Error('Image encoding failed.')),
          'image/jpeg',
          JPEG_QUALITY,
        );
      });
    } finally {
      bitmap.close();
    }
  }

  /**
   * Upload a (already resized) photo for a plant and record it as the
   * plant's primary photo. Throws on failure — the CALLER decides that
   * photo failure is non-fatal (the plant row already exists by then).
   */
  async uploadPlantPhoto(plantId: string, photo: Blob): Promise<void> {
    const {
      data: { user },
    } = await this.supabase.client.auth.getUser();
    if (!user) throw new Error('Not signed in.');

    const path = `${user.id}/${plantId}/${crypto.randomUUID()}.jpg`;

    const { error: uploadError } = await this.supabase.client.storage
      .from(BUCKET)
      .upload(path, photo, { contentType: 'image/jpeg' });
    if (uploadError) throw uploadError;

    const { error: insertError } = await this.supabase.client
      .from('plant_photos')
      .insert({ plant_id: plantId, storage_path: path, is_primary: true });
    if (insertError) throw insertError;
  }

  /**
   * Map plant ids to signed URLs for their primary photos. Best-effort:
   * any failure returns {} (or partial data) rather than throwing,
   * because thumbnails are decoration — the page must render without
   * them. Signed URLs expire after an hour; pages re-fetch on mount.
   */
  async getPrimaryPhotoUrls(
    plantIds: string[],
  ): Promise<Record<string, string>> {
    if (!plantIds.length) return {};

    const { data, error } = await this.supabase.client
      .from('plant_photos')
      .select('plant_id, storage_path')
      .eq('is_primary', true)
      .in('plant_id', plantIds);
    if (error || !data?.length) return {};

    const { data: signed, error: signError } = await this.supabase.client.storage
      .from(BUCKET)
      .createSignedUrls(
        data.map((row) => row.storage_path),
        SIGNED_URL_TTL_SECONDS,
      );
    if (signError || !signed) return {};

    const urlByPath = new Map(
      signed
        .filter((s) => s.signedUrl)
        .map((s) => [s.path, s.signedUrl] as const),
    );
    return Object.fromEntries(
      data
        .map((row) => [row.plant_id, urlByPath.get(row.storage_path)] as const)
        .filter((entry): entry is [string, string] => !!entry[1]),
    );
  }
}
```

- [ ] **Step 5.4: Run tests to verify they pass**

Run: `npm test -- --watch=false`
Expected: PASS.

- [ ] **Step 5.5: Commit**

```bash
git add src/app/gardens/photo.service.ts src/app/gardens/photo.service.spec.ts
git commit -m "feat: add PhotoService for resize, storage upload, and signed URLs"
```

---

### Task 6: SpeciesService.ensureByIdentification()

**Files:**
- Modify: `src/app/gardens/species.service.ts`
- Test: `src/app/gardens/species.service.spec.ts` (new)

- [ ] **Step 6.1: Write the failing tests**

Create `src/app/gardens/species.service.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Species, SpeciesService } from './species.service';
import { SupabaseService } from '../supabase.service';
import { PerenualService } from './perenual.service';
import { PlantIdCandidate } from './plant-id.service';

const CANDIDATE: PlantIdCandidate = {
  scientificName: 'Lavandula angustifolia',
  commonNames: ['English lavender', 'True lavender'],
  score: 0.87,
  thumbnailUrl: null,
};

const EXISTING: Species = {
  id: 'sp-1',
  user_id: 'user-1',
  common_name: 'Lavender',
  scientific_name: 'Lavandula angustifolia',
  display_number: 3,
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
};

describe('SpeciesService.ensureByIdentification', () => {
  let service: SpeciesService;

  // One vi.fn() per terminal Supabase call; the chain methods in between
  // are recreated per `from()` call so different queries don't collide.
  const maybeSingleMock = vi.fn();
  const updateSingleMock = vi.fn();
  const insertSingleMock = vi.fn();
  const maxMaybeSingleMock = vi.fn();
  const insertPayloads: unknown[] = [];

  const supabaseMock = {
    client: {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      },
      from: vi.fn(() => ({
        select: vi.fn((columns?: string) => ({
          or: vi.fn(() => ({ maybeSingle: maybeSingleMock })),
          order: vi.fn(() => ({
            limit: vi.fn(() => ({ maybeSingle: maxMaybeSingleMock })),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({ single: updateSingleMock })),
          })),
        })),
        insert: vi.fn((payload: unknown) => {
          insertPayloads.push(payload);
          return { select: vi.fn(() => ({ single: insertSingleMock })) };
        }),
      })),
    },
  };

  const perenualMock = { searchByScientificName: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    insertPayloads.length = 0;
    supabaseMock.client.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseService, useValue: supabaseMock },
        { provide: PerenualService, useValue: perenualMock },
      ],
    });
    service = TestBed.inject(SpeciesService);
  });

  it('returns an existing species without calling Perenual', async () => {
    maybeSingleMock.mockResolvedValue({ data: EXISTING, error: null });

    const result = await service.ensureByIdentification(CANDIDATE);

    expect(result).toEqual(EXISTING);
    expect(perenualMock.searchByScientificName).not.toHaveBeenCalled();
  });

  it('backfills scientific_name on an existing species that lacks it', async () => {
    const unidentified = { ...EXISTING, scientific_name: null };
    const backfilled = { ...EXISTING };
    maybeSingleMock.mockResolvedValue({ data: unidentified, error: null });
    updateSingleMock.mockResolvedValue({ data: backfilled, error: null });

    const result = await service.ensureByIdentification(CANDIDATE);
    expect(result.scientific_name).toBe('Lavandula angustifolia');
  });

  it('creates a Perenual-enriched species when no match exists', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    maxMaybeSingleMock.mockResolvedValue({ data: { display_number: 7 }, error: null });
    perenualMock.searchByScientificName.mockResolvedValue({
      externalId: '2',
      heightFtMin: 1,
      heightFtMax: 3,
      raw: { id: 2 },
    });
    insertSingleMock.mockResolvedValue({
      data: { ...EXISTING, id: 'sp-new', display_number: 8 },
      error: null,
    });

    await service.ensureByIdentification(CANDIDATE);

    expect(insertPayloads[0]).toEqual({
      user_id: 'user-1',
      common_name: 'English lavender',
      scientific_name: 'Lavandula angustifolia',
      display_number: 8,
      external_source: 'perenual',
      external_id: '2',
      height_ft_min: 1,
      height_ft_max: 3,
      external_data: { id: 2 },
    });
  });

  it('creates a plantnet-only species when Perenual finds nothing', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    maxMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    perenualMock.searchByScientificName.mockResolvedValue(null);
    insertSingleMock.mockResolvedValue({
      data: { ...EXISTING, id: 'sp-new', display_number: 1 },
      error: null,
    });

    await service.ensureByIdentification(CANDIDATE);

    expect(insertPayloads[0]).toMatchObject({
      common_name: 'English lavender',
      scientific_name: 'Lavandula angustifolia',
      display_number: 1,
      external_source: 'plantnet',
    });
    const payload = insertPayloads[0] as Record<string, unknown>;
    expect(payload['external_id']).toBeUndefined();
    expect(payload['height_ft_min']).toBeUndefined();
  });

  it('falls back to the scientific name when the candidate has no common names', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    maxMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    perenualMock.searchByScientificName.mockResolvedValue(null);
    insertSingleMock.mockResolvedValue({ data: EXISTING, error: null });

    await service.ensureByIdentification({ ...CANDIDATE, commonNames: [] });

    expect(insertPayloads[0]).toMatchObject({
      common_name: 'Lavandula angustifolia',
    });
  });
});
```

- [ ] **Step 6.2: Run tests to verify they fail**

Run: `npm test -- --watch=false`
Expected: FAIL — `ensureByIdentification` does not exist.

- [ ] **Step 6.3: Implement ensureByIdentification**

In `src/app/gardens/species.service.ts`:

Add imports at the top:

```ts
import { PerenualService } from './perenual.service';
import { PlantIdCandidate } from './plant-id.service';
```

Add `private perenual = inject(PerenualService);` next to the existing `private supabase = inject(SupabaseService);`.

Extend the `Species` interface with the external-cache columns (they exist in the DB since migration 20260531000001 but were never typed):

```ts
  /** 'perenual' | 'plantnet' | 'llm' | 'manual' — which system filled the external columns. */
  external_source: string | null;
  external_id: string | null;
  height_ft_min: number | null;
  height_ft_max: number | null;
  external_data: unknown | null;
```

Then add this method to the class, after `ensureByName`:

```ts
  /**
   * Resolve a Pl@ntNet identification into a species row — the
   * photo-flow sibling of ensureByName. See the spec
   * (docs/superpowers/specs/2026-06-10-photo-plant-identification-design.md
   * section 4) for the find → enrich → create chain.
   *
   *   1. FIND: match the scientific name against scientific_name OR
   *      common_name (case-insensitive). If found, return it —
   *      backfilling scientific_name when the row predates
   *      identification.
   *   2. ENRICH: for a new species, ask Perenual for growing data
   *      (best-effort; null on any failure).
   *   3. CREATE: insert with the next display_number. external_source
   *      records which system provided the data ('perenual' when the
   *      lookup hit, 'plantnet' when we only have Pl@ntNet's names).
   */
  async ensureByIdentification(candidate: PlantIdCandidate): Promise<Species> {
    const scientificName = candidate.scientificName.trim();
    if (!scientificName) {
      throw new Error('Candidate has no scientific name.');
    }

    // Step 1: find by scientific name in either name column.
    const { data: existing, error: selectError } = await this.supabase.client
      .from('species')
      .select('*')
      .or(
        `scientific_name.ilike.${scientificName},common_name.ilike.${scientificName}`,
      )
      .maybeSingle();
    if (selectError) throw selectError;

    if (existing) {
      const found = existing as Species;
      if (found.scientific_name) return found;

      // Backfill: the species existed from a typed name; the photo
      // identification just told us what it actually is.
      const { data: updated, error: updateError } = await this.supabase.client
        .from('species')
        .update({ scientific_name: scientificName })
        .eq('id', found.id)
        .select()
        .single();
      if (updateError) throw updateError;
      return updated as Species;
    }

    // Step 2: enrich via Perenual (null = lookup failed or no match).
    const perenualData =
      await this.perenual.searchByScientificName(scientificName);

    // Step 3: create, same next-number pattern as ensureByName.
    const {
      data: { user },
    } = await this.supabase.client.auth.getUser();
    if (!user) throw new Error('Not signed in.');

    const { data: maxRow, error: maxError } = await this.supabase.client
      .from('species')
      .select('display_number')
      .order('display_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxError) throw maxError;
    const nextNumber = (maxRow?.display_number ?? 0) + 1;

    const { data: created, error: insertError } = await this.supabase.client
      .from('species')
      .insert({
        user_id: user.id,
        common_name: candidate.commonNames[0] ?? scientificName,
        scientific_name: scientificName,
        display_number: nextNumber,
        external_source: perenualData ? 'perenual' : 'plantnet',
        ...(perenualData && {
          external_id: perenualData.externalId,
          height_ft_min: perenualData.heightFtMin,
          height_ft_max: perenualData.heightFtMax,
          external_data: perenualData.raw,
        }),
      })
      .select()
      .single();
    if (insertError) throw insertError;
    return created as Species;
  }
```

- [ ] **Step 6.4: Run tests to verify they pass**

Run: `npm test -- --watch=false`
Expected: PASS. If extending the `Species` interface breaks compilation of existing specs/components (it shouldn't — all new fields are nullable additions), fix the call sites.

- [ ] **Step 6.5: Commit**

```bash
git add src/app/gardens/species.service.ts src/app/gardens/species.service.spec.ts
git commit -m "feat: resolve Pl@ntNet identifications into species with Perenual enrichment"
```

---

### Task 7: PlantService accepts plantnet_score

**Files:**
- Modify: `src/app/gardens/plant.service.ts`
- Test: `src/app/gardens/plant.service.spec.ts` (new)

- [ ] **Step 7.1: Write the failing test**

Create `src/app/gardens/plant.service.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PlantService } from './plant.service';
import { SupabaseService } from '../supabase.service';

describe('PlantService.create', () => {
  let service: PlantService;
  const singleMock = vi.fn();
  const insertPayloads: unknown[] = [];

  const supabaseMock = {
    client: {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      },
      from: vi.fn(() => ({
        insert: vi.fn((payload: unknown) => {
          insertPayloads.push(payload);
          return { select: vi.fn(() => ({ single: singleMock })) };
        }),
      })),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    insertPayloads.length = 0;
    TestBed.configureTestingModule({
      providers: [{ provide: SupabaseService, useValue: supabaseMock }],
    });
    service = TestBed.inject(PlantService);
  });

  it('includes plantnet_score when provided', async () => {
    singleMock.mockResolvedValue({ data: { id: 'p1' }, error: null });

    await service.create({
      garden_id: 'g1',
      species_id: 'sp1',
      plantnet_score: 0.87,
    });

    expect(insertPayloads[0]).toMatchObject({ plantnet_score: 0.87 });
  });

  it('omits plantnet_score when absent (typed-name path unchanged)', async () => {
    singleMock.mockResolvedValue({ data: { id: 'p1' }, error: null });

    await service.create({ garden_id: 'g1', species_id: 'sp1' });

    expect(
      Object.keys(insertPayloads[0] as Record<string, unknown>),
    ).not.toContain('plantnet_score');
  });
});
```

- [ ] **Step 7.2: Run tests to verify the first one fails**

Run: `npm test -- --watch=false`
Expected: FAIL — `plantnet_score` isn't in `NewPlantInput` (TypeScript error) / not in the insert payload.

- [ ] **Step 7.3: Implement**

In `src/app/gardens/plant.service.ts`:

Add to `NewPlantInput` (after `notes?: string;`):

```ts
  /** Pl@ntNet confidence (0..1) when the plant came from photo identification. */
  plantnet_score?: number;
```

In `create()`, add to the insert object alongside the other key-omission spreads:

```ts
        ...(input.plantnet_score !== undefined && {
          plantnet_score: input.plantnet_score,
        }),
```

- [ ] **Step 7.4: Run tests to verify they pass**

Run: `npm test -- --watch=false`
Expected: PASS.

- [ ] **Step 7.5: Commit**

```bash
git add src/app/gardens/plant.service.ts src/app/gardens/plant.service.spec.ts
git commit -m "feat: record Pl@ntNet confidence score on photo-identified plants"
```

---

### Task 8: IdentifyPlantComponent

**Files:**
- Create: `src/app/gardens/identify-plant/identify-plant.ts`
- Create: `src/app/gardens/identify-plant/identify-plant.html`
- Create: `src/app/gardens/identify-plant/identify-plant.scss`
- Test: `src/app/gardens/identify-plant/identify-plant.spec.ts`

The component owns capture → resize → identify → candidate picking, and emits `{ candidate, photo }` for the parent to persist. It never touches the database.

- [ ] **Step 8.1: Write the failing tests**

Create `src/app/gardens/identify-plant/identify-plant.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { IdentifyPlant } from './identify-plant';
import { PlantIdError, PlantIdService } from '../plant-id.service';
import { PhotoService } from '../photo.service';

const CANDIDATES = [
  {
    scientificName: 'Lavandula angustifolia',
    commonNames: ['English lavender'],
    score: 0.87,
    thumbnailUrl: 'https://img/1',
  },
  {
    scientificName: 'Lavandula stoechas',
    commonNames: [],
    score: 0.05,
    thumbnailUrl: null,
  },
];

describe('IdentifyPlant', () => {
  const plantIdMock = { identify: vi.fn() };
  const photoMock = { resizeImage: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    photoMock.resizeImage.mockResolvedValue(new Blob(['resized']));
    await TestBed.configureTestingModule({
      imports: [IdentifyPlant],
      providers: [
        { provide: PlantIdService, useValue: plantIdMock },
        { provide: PhotoService, useValue: photoMock },
      ],
    }).compileComponents();
  });

  function create() {
    const fixture = TestBed.createComponent(IdentifyPlant);
    fixture.detectChanges();
    return fixture;
  }

  it('starts idle, showing only the identify button', () => {
    const fixture = create();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.identify-plant__trigger')).toBeTruthy();
    expect(el.querySelector('.identify-plant__candidates')).toBeFalsy();
  });

  it('shows candidates after a successful identification', async () => {
    plantIdMock.identify.mockResolvedValue(CANDIDATES);
    const fixture = create();

    await fixture.componentInstance.onFileSelected(
      new File(['x'], 'photo.jpg', { type: 'image/jpeg' }),
    );
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const cards = el.querySelectorAll('.identify-plant__candidate');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('English lavender');
    expect(cards[0].textContent).toContain('Lavandula angustifolia');
    expect(cards[0].textContent).toContain('87%');
    expect(photoMock.resizeImage).toHaveBeenCalled();
    expect(plantIdMock.identify).toHaveBeenCalledWith(expect.any(Blob));
  });

  it('shows a low-confidence caveat when the top score is under 10%', async () => {
    plantIdMock.identify.mockResolvedValue([{ ...CANDIDATES[1] }]);
    const fixture = create();

    await fixture.componentInstance.onFileSelected(
      new File(['x'], 'photo.jpg', { type: 'image/jpeg' }),
    );
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '.identify-plant__low-confidence',
      ),
    ).toBeTruthy();
  });

  it('shows a not-identified message when zero candidates come back', async () => {
    plantIdMock.identify.mockResolvedValue([]);
    const fixture = create();

    await fixture.componentInstance.onFileSelected(
      new File(['x'], 'photo.jpg', { type: 'image/jpeg' }),
    );
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      "couldn't identify",
    );
  });

  it('shows the error message when identification throws', async () => {
    plantIdMock.identify.mockRejectedValue(
      new PlantIdError('Daily identification limit reached', 429),
    );
    const fixture = create();

    await fixture.componentInstance.onFileSelected(
      new File(['x'], 'photo.jpg', { type: 'image/jpeg' }),
    );
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Daily identification limit reached',
    );
  });

  it('emits the chosen candidate with the resized photo', async () => {
    plantIdMock.identify.mockResolvedValue(CANDIDATES);
    const fixture = create();
    const emitted = vi.fn();
    fixture.componentInstance.confirmed.subscribe(emitted);

    await fixture.componentInstance.onFileSelected(
      new File(['x'], 'photo.jpg', { type: 'image/jpeg' }),
    );
    fixture.componentInstance.onPick(CANDIDATES[0]);

    expect(emitted).toHaveBeenCalledWith({
      candidate: CANDIDATES[0],
      photo: expect.any(Blob),
    });
  });

  it('resets to idle when the user dismisses the results', async () => {
    plantIdMock.identify.mockResolvedValue(CANDIDATES);
    const fixture = create();

    await fixture.componentInstance.onFileSelected(
      new File(['x'], 'photo.jpg', { type: 'image/jpeg' }),
    );
    fixture.componentInstance.onDismiss();
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '.identify-plant__candidates',
      ),
    ).toBeFalsy();
  });
});
```

- [ ] **Step 8.2: Run tests to verify they fail**

Run: `npm test -- --watch=false`
Expected: FAIL — `identify-plant` module not found.

- [ ] **Step 8.3: Write the component class**

Create `src/app/gardens/identify-plant/identify-plant.ts`:

```ts
import { Component, inject, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { PlantIdCandidate, PlantIdService } from '../plant-id.service';
import { PhotoService } from '../photo.service';

/** Payload emitted when the user confirms a candidate. */
export interface IdentificationResult {
  candidate: PlantIdCandidate;
  /** The resized JPEG that was sent to Pl@ntNet — ready for Storage upload. */
  photo: Blob;
}

type IdentifyState = 'idle' | 'identifying' | 'results' | 'error';

/**
 * Photo-identification widget for the add-plant form.
 *
 * Owns the capture → resize → Pl@ntNet → candidate-picking flow and
 * emits the user's choice; the PARENT (garden-detail) persists species,
 * plant, and photo. Keeping persistence out of here means this
 * component needs no Supabase access and stays trivially testable.
 *
 * Browser-only by construction: it renders inside garden-detail's
 * isPlatformBrowser-guarded content and reacts only to user events.
 */
@Component({
  selector: 'app-identify-plant',
  imports: [DecimalPipe],
  templateUrl: './identify-plant.html',
  styleUrl: './identify-plant.scss',
})
export class IdentifyPlant {
  private plantId = inject(PlantIdService);
  private photoService = inject(PhotoService);

  /** Fires when the user picks a candidate. Parent persists everything. */
  readonly confirmed = output<IdentificationResult>();

  readonly state = signal<IdentifyState>('idle');
  readonly candidates = signal<PlantIdCandidate[]>([]);
  readonly errorMessage = signal<string | null>(null);

  /** The resized photo from the most recent identification run. */
  private photo: Blob | null = null;

  /** True when the top candidate is below 10% confidence. */
  get lowConfidence(): boolean {
    const top = this.candidates()[0];
    return !!top && top.score < 0.1;
  }

  /** Template hook for the hidden file input's (change) event. */
  onFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same file
    if (file) void this.onFileSelected(file);
  }

  /** Resize the chosen image and run identification. */
  async onFileSelected(file: File): Promise<void> {
    this.state.set('identifying');
    this.errorMessage.set(null);

    try {
      this.photo = await this.photoService.resizeImage(file);
      this.candidates.set(await this.plantId.identify(this.photo));
      this.state.set('results');
    } catch (err) {
      this.errorMessage.set(
        err instanceof Error ? err.message : 'Identification failed.',
      );
      this.state.set('error');
    }
  }

  onPick(candidate: PlantIdCandidate): void {
    if (!this.photo) return;
    this.confirmed.emit({ candidate, photo: this.photo });
    this.onDismiss();
  }

  /** "None of these" / close — back to idle; the typed-name form is the fallback. */
  onDismiss(): void {
    this.state.set('idle');
    this.candidates.set([]);
    this.errorMessage.set(null);
    this.photo = null;
  }
}
```

- [ ] **Step 8.4: Write the template**

Create `src/app/gardens/identify-plant/identify-plant.html`:

```html
<div class="identify-plant">
  @if (state() === 'idle' || state() === 'identifying') {
    <label class="identify-plant__trigger btn btn--secondary">
      {{ state() === 'identifying' ? 'Identifying…' : '📷 Identify from photo' }}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        [disabled]="state() === 'identifying'"
        (change)="onFileInputChange($event)"
        class="identify-plant__file-input"
      />
    </label>
  }

  @if (state() === 'error') {
    <p class="identify-plant__error">
      {{ errorMessage() }}
      <button type="button" class="identify-plant__dismiss" (click)="onDismiss()">
        Type a name instead
      </button>
    </p>
  }

  @if (state() === 'results') {
    @if (candidates().length === 0) {
      <p class="identify-plant__error">
        Sorry, we couldn't identify this photo.
        <button type="button" class="identify-plant__dismiss" (click)="onDismiss()">
          Type a name instead
        </button>
      </p>
    } @else {
      <div class="identify-plant__candidates">
        @if (lowConfidence) {
          <p class="identify-plant__low-confidence">
            Low confidence — these may not be right.
          </p>
        }
        @for (candidate of candidates(); track candidate.scientificName) {
          <button
            type="button"
            class="identify-plant__candidate"
            (click)="onPick(candidate)"
          >
            @if (candidate.thumbnailUrl) {
              <img
                [src]="candidate.thumbnailUrl"
                alt=""
                class="identify-plant__thumb"
              />
            }
            <span class="identify-plant__names">
              <strong>{{ candidate.commonNames[0] || candidate.scientificName }}</strong>
              <em>{{ candidate.scientificName }}</em>
            </span>
            <span class="identify-plant__score">
              <span
                class="identify-plant__score-bar"
                [style.width.%]="candidate.score * 100"
              ></span>
              {{ candidate.score * 100 | number: '1.0-0' }}%
            </span>
          </button>
        }
        <button
          type="button"
          class="identify-plant__dismiss"
          (click)="onDismiss()"
        >
          None of these — type a name instead
        </button>
      </div>
    }
  }
</div>
```

- [ ] **Step 8.5: Write the styles**

Create `src/app/gardens/identify-plant/identify-plant.scss`:

```scss
.identify-plant {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

// The trigger is a <label> styled as a button; the real file input is
// visually hidden but still focusable/clickable through the label.
.identify-plant__trigger {
  cursor: pointer;
  align-self: flex-start;
}

.identify-plant__file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  overflow: hidden;
}

.identify-plant__candidates {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.identify-plant__candidate {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem;
  border: 1px solid var(--color-border, #ccc);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  text-align: left;

  &:hover {
    border-color: var(--color-primary, #2e7d32);
  }
}

.identify-plant__thumb {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 4px;
}

.identify-plant__names {
  display: flex;
  flex-direction: column;
  flex: 1;

  em {
    font-style: italic;
    opacity: 0.7;
    font-size: 0.85em;
  }
}

.identify-plant__score {
  position: relative;
  min-width: 64px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.identify-plant__score-bar {
  position: absolute;
  left: 0;
  bottom: -4px;
  height: 3px;
  background: var(--color-primary, #2e7d32);
  border-radius: 2px;
}

.identify-plant__low-confidence,
.identify-plant__error {
  margin: 0;
  font-size: 0.9em;
  color: var(--color-danger, #b00020);
}

.identify-plant__dismiss {
  background: none;
  border: none;
  padding: 0;
  text-decoration: underline;
  cursor: pointer;
  font-size: 0.9em;
  align-self: flex-start;
}
```

- [ ] **Step 8.6: Run tests to verify they pass**

Run: `npm test -- --watch=false`
Expected: PASS.

- [ ] **Step 8.7: Commit**

```bash
git add src/app/gardens/identify-plant/
git commit -m "feat: add IdentifyPlant component (capture, candidates, confirm)"
```

---

### Task 9: Garden-detail integration (persist flow + thumbnails)

**Files:**
- Modify: `src/app/gardens/garden-detail/garden-detail.ts`
- Modify: `src/app/gardens/garden-detail/garden-detail.html`
- Modify: `src/app/gardens/garden-detail/garden-detail.scss`

This is wiring, verified by the existing suite still passing plus manual testing (Task 10) — the persistence chain's pieces are each unit-tested already.

- [ ] **Step 9.1: Update the component class**

In `src/app/gardens/garden-detail/garden-detail.ts`:

Add imports:

```ts
import { PhotoService } from '../photo.service';
import {
  IdentificationResult,
  IdentifyPlant,
} from '../identify-plant/identify-plant';
```

Add `IdentifyPlant` to the `@Component` imports array: `imports: [RouterLink, DatePipe, FormsModule, IdentifyPlant],`

Add to the class, next to the other injects and signals:

```ts
  private photoService = inject(PhotoService);

  // plant_id → signed thumbnail URL for primary photos. Best-effort:
  // empty when photos don't exist or the signed-URL fetch failed.
  photoUrls = signal<Record<string, string>>({});
  // Non-fatal photo-save failure message, separate from errorMessage so
  // a photo hiccup doesn't read like the plant failed.
  photoWarning = signal<string | null>(null);
```

In `ngOnInit`, after `this.plants.set(garden?.plants ?? []);`, add:

```ts
      // Thumbnails load after the page renders; failures leave the map empty.
      void this.loadPhotoUrls(garden?.plants?.map((p) => p.id) ?? []);
```

Add these methods after `onAddPlant()`:

```ts
  private async loadPhotoUrls(plantIds: string[]): Promise<void> {
    this.photoUrls.set(await this.photoService.getPrimaryPhotoUrls(plantIds));
  }

  /**
   * Persist a confirmed photo identification. Mirrors onAddPlant's
   * two-step species→plant flow, with two additions: the species comes
   * from the identification (Perenual-enriched), and the photo is
   * uploaded afterward. Photo failure is NON-fatal by design (spec
   * section 5): the identified plant is the valuable part.
   */
  async onIdentified(result: IdentificationResult): Promise<void> {
    if (!this.id) return;
    const garden = this.garden();
    if (!garden) return;

    this.addingPlant.set(true);
    this.errorMessage.set(null);
    this.photoWarning.set(null);

    try {
      const species = await this.speciesService.ensureByIdentification(
        result.candidate,
      );

      const created = await this.plantService.create({
        garden_id: this.id,
        species_id: species.id,
        diameter_ft: this.newPlantDiameter(),
        position_x_ft: garden.width_ft / 2,
        position_y_ft: garden.height_ft / 2,
        plantnet_score: result.candidate.score,
      });

      this.plants.update((list) => [...list, { ...created, species }]);
      this.allSpecies.update((list) =>
        list.find((s) => s.id === species.id) ? list : [...list, species],
      );

      try {
        await this.photoService.uploadPlantPhoto(created.id, result.photo);
        await this.loadPhotoUrls(this.plants().map((p) => p.id));
      } catch {
        this.photoWarning.set(
          'Plant saved, but the photo could not be uploaded.',
        );
      }
    } catch (err) {
      this.errorMessage.set(
        err instanceof Error ? err.message : 'Failed to add plant.',
      );
    } finally {
      this.addingPlant.set(false);
    }
  }
```

- [ ] **Step 9.2: Update the template**

In `src/app/gardens/garden-detail/garden-detail.html`:

After the inline error slot (`@if (errorMessage()) { … }` around line 46), add:

```html
    @if (photoWarning()) {
      <p class="garden-detail__warning">{{ photoWarning() }}</p>
    }
```

Inside the plant list item, right after `<li class="garden-detail__plant">` (before the name span), add the thumbnail:

```html
              @if (photoUrls()[plant.id]; as url) {
                <img
                  [src]="url"
                  alt=""
                  class="garden-detail__plant-photo"
                />
              }
```

Inside the add-plant `<form>`, immediately before the Name `<label>`, add:

```html
        <app-identify-plant (confirmed)="onIdentified($event)" />
```

- [ ] **Step 9.3: Add styles**

In `src/app/gardens/garden-detail/garden-detail.scss`, append:

```scss
.garden-detail__plant-photo {
  width: 40px;
  height: 40px;
  object-fit: cover;
  border-radius: 4px;
  margin-right: 0.5rem;
}

.garden-detail__warning {
  color: var(--color-warning, #8a6d00);
  font-size: 0.9em;
}
```

- [ ] **Step 9.4: Run the full suite and a production build**

```bash
npm test -- --watch=false
npm run build
```

Expected: tests PASS, build succeeds (catches template type errors and SSR issues).

- [ ] **Step 9.5: Commit**

```bash
git add src/app/gardens/garden-detail/
git commit -m "feat: wire photo identification into the add-plant flow with thumbnails"
```

---

### Task 10: Housekeeping + manual verification

**Files:**
- Modify: `src/environments/environment.example.ts`
- Modify: `DECISIONS.md`

- [ ] **Step 10.1: Replace the leaked Perenual key in the example file**

In `src/environments/environment.example.ts`, replace the real key string in the `perenual` block with `'YOUR-PERENUAL-API-KEY'`. Remind the user to rotate the old key at perenual.com (a committed key is burned even after the file is fixed — it lives in git history).

- [ ] **Step 10.2: Scaffold DECISIONS.md Entry #15**

Append to `DECISIONS.md`, following the existing template (Context/Options/Decision filled in; Why/Tradeoffs as italic hints for the user to rewrite, per the file's own convention):

```markdown
## 15. Client-direct Pl@ntNet calls with domain-whitelisted CORS
**Date:** 2026-06-10
**Status:** Accepted

**Context.** The photo-identification feature needs to call Pl@ntNet's API. The key can live in the client bundle (simple, exposed) or behind a server-side proxy (safe, more infrastructure). Pl@ntNet supports browser CORS when the calling origins are registered as "Authorized domains" in the developer account.

**Options considered.**
- **Client-direct** — browser calls Pl@ntNet; key in environment.ts; origins whitelisted at Pl@ntNet.
- **Supabase Edge Function proxy** — Deno function holds the key server-side.
- **SSR Express route** — /api/identify on the existing Angular SSR server.

**Decision.** Client-direct, consistent with the Perenual-key tradeoff already accepted in Entry #14. The Edge Function proxy remains the documented hardening step.

**Why (in my own words).**
*Hints: same architectural smell already accepted for Perenual — one consistent posture beats two; zero new deploy artifacts; the origin whitelist limits browser-based abuse even though it can't stop curl with a stolen key.*

**Tradeoffs / what we're giving up.**
*Hints: the key ships in the bundle and could be exfiltrated for someone else's 500/day quota; rotating means a redeploy; the proxy migration touches only PlantIdService/PerenualService internals when it happens.*
```

- [ ] **Step 10.3: Commit**

```bash
git add src/environments/environment.example.ts DECISIONS.md
git commit -m "docs: scrub example API key, add DECISIONS entry for client-direct Pl@ntNet"
```

- [ ] **Step 10.4: Manual verification checklist (requires user's API keys + applied migration)**

Run `npm start` and verify on `http://localhost:4200`:

1. Garden detail → add-plant form shows the "📷 Identify from photo" button.
2. Selecting a clear plant photo shows up to 3 candidates with names + confidence within a few seconds.
3. Picking a candidate adds the plant to the list with the species name and a thumbnail.
4. The species appears in the autocomplete datalist afterward, with `scientific_name`, `external_source`, and (for Perenual hits) `height_ft_min/max` populated — check in Supabase Studio's table editor.
5. The photo exists in Storage under `plant-photos/{user_id}/{plant_id}/`.
6. "None of these — type a name instead" returns to the normal form, and the typed-name path still works.
7. On a phone (or devtools device emulation), the file input opens the camera.
8. With a wrong API key in environment.ts, identification shows the error message and the typed path still works.

Prerequisites the user must have completed (spec section 9): Pl@ntNet key in `environment.ts`, `http://localhost:4200` in Pl@ntNet Authorized domains, migration from Task 4 applied.

---

## Self-Review Notes

- **Spec coverage:** flow (Task 8/9), species chain (Task 6), Perenual enrichment (Task 3), photo storage + signed URLs (Tasks 4/5), plantnet_score on plant (Task 7), error-handling table (Tasks 1/3/8/9 — quota, zero results, low confidence, Perenual best-effort, non-fatal photo failure), SSR safety (component event-driven + behind existing guard), owner setup (Task 0/10).
- **Type consistency check:** `PlantIdCandidate` (Task 1) used in Tasks 6/8/9; `IdentificationResult` (Task 8) used in Task 9; `PerenualSpeciesData` (Task 3) used in Task 6; `NewPlantInput.plantnet_score` (Task 7) used in Task 9.
- **Known judgment calls:** Perenual response shapes vary between API versions — the mapper is defensive and null-tolerant by design; if real responses differ during manual testing, adjust `extractHeightFt`/`pickBestMatch` fixtures to match reality, keeping the null-fallback behavior.
